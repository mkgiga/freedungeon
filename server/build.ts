/**
 * Builds freedungeon into a single standalone executable.
 *
 *   bun run build              # host platform
 *   bun run build --skip-client   # reuse the existing client/dist
 *
 * What this has to work around, all verified against Bun 1.3.7:
 *
 *  - `import.meta.dirname` inside a compiled binary points at the virtual
 *    filesystem (`B:\~BUN\root`), and `readdirSync` on it fails outright, so
 *    nothing can be discovered at runtime.
 *  - Bun embeds a file only for a literal `import … with { type: 'file' }`.
 *    `compile.assets` (directory embedding) is accepted by the API but embeds
 *    nothing in 1.3.7, and there is no `import.meta.glob`. So the file set has
 *    to be fixed at build time. Rather than emitting one import per file, we
 *    pack everything into a single blob (src/asset-blob.ts) that the
 *    hand-written src/entry.ts imports — one static import regardless of how
 *    many files there are, and no generated source to typecheck or maintain.
 *  - sharp resolves its native binding with `require(path)` over a runtime
 *    array, so the bundler never sees those specifiers. We replace
 *    sharp/lib/sharp.js wholesale with a shim, and extract the real .node plus
 *    its libvips DLLs to the data dir at startup — Windows' loader needs the
 *    DLLs to sit next to the .node on a real filesystem.
 */

import path from 'node:path'
import fs from 'node:fs'
import type { BunPlugin } from 'bun'
import { packBlob, type BlobEntry } from './src/asset-blob'

const ROOT = import.meta.dirname
const REPO = path.join(ROOT, '..')
const DIST = path.join(ROOT, 'client', 'dist')
const PROMPTS = path.join(ROOT, 'src', 'prompts')
const OUT_DIR = path.join(ROOT, 'dist')

const skipClient = process.argv.includes('--skip-client')
/** The Rust half is slow and rarely changing; skip it while iterating on the server. */
const skipDesktop = process.argv.includes('--skip-desktop')

// ── Native modules ──────────────────────────────────────────────────────────

/** Platform-specific files that must reach a real filesystem to be loadable. */
type Native = { src: string; name: string }

const PLATFORM = `${process.platform}-${process.arch}`
/** The binding sharp's shim will require, once extracted. */
const SHARP_BINDING = `sharp-${PLATFORM}.node`

/**
 * sharp's prebuilt binary lives in a separate per-platform package. Resolve it
 * through sharp's own tree (where bun's isolated store puts it) before falling
 * back to a hoisted top-level install.
 */
function findSharpNatives(): Native[] {
    const pkg = `@img/sharp-${PLATFORM}`
    // Resolve from the server package — sharp is its dependency, not the root's.
    const sharpRoot = path.join(path.dirname(Bun.resolveSync('sharp', ROOT)), '..')
    const candidates = [
        path.join(sharpRoot, '..', pkg, 'lib'),
        path.join(sharpRoot, 'node_modules', pkg, 'lib'),
        path.join(REPO, 'node_modules', pkg, 'lib'),
    ]
    const dir = candidates.find(c => fs.existsSync(c))
    if (!dir) {
        throw new Error(`No ${pkg} found (looked in:\n  ${candidates.join('\n  ')}\n). Run \`bun install\` first.`)
    }
    // The .node plus every DLL beside it — Windows resolves those siblings from
    // the directory the binding is loaded from.
    return nativeFilesIn(dir)
}

/** Every loadable native file directly inside `dir`. */
function nativeFilesIn(dir: string): Native[] {
    return fs.readdirSync(dir)
        .filter(f => /\.(node|dll|so|dylib)$/.test(f))
        .map(f => ({ src: path.join(dir, f), name: f }))
}

/**
 * onnxruntime-node keeps a per-platform binding under bin/napi-v6/, loaded via
 * a template-literal require the bundler can't see. Same treatment as sharp:
 * embed the binding plus the runtime DLLs it links against, and extract them
 * together so the loader resolves the siblings from a real directory.
 */
function findOnnxNatives(): Native[] {
    const dir = path.join(
        path.dirname(Bun.resolveSync('onnxruntime-node', ROOT)), '..',
        'bin', 'napi-v6', process.platform, process.arch,
    )
    if (!fs.existsSync(dir)) {
        throw new Error(`No onnxruntime-node binding for ${PLATFORM} at ${dir}. Run \`bun install\` first.`)
    }
    // The DirectML provider's libraries are ~37MB and bg-removal.ts pins
    // EXECUTION_PROVIDERS to ['cpu'], so they never load. Verified by running
    // background removal with them absent — inference is unaffected. If that
    // provider list ever gains 'dml', drop this filter.
    const dmlOnly = /^(DirectML|dxcompiler|dxil)\.dll$/i
    return nativeFilesIn(dir).filter(n => !dmlOnly.test(n.name))
}

// ── Asset packing ───────────────────────────────────────────────────────────

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter(e => e.isFile())
        .map(e => path.relative(dir, path.join(e.parentPath, e.name)))
}

/**
 * Pack everything the binary can't read from disk into one blob. Keys are
 * prefixed by kind so entry.ts can sort them apart without a second index.
 */
function buildAssetBlob(natives: Native[]): Uint8Array {
    const clientFiles = fs.existsSync(DIST) ? walk(DIST) : []
    if (clientFiles.length === 0) {
        throw new Error(`No client build at ${DIST}. Run without --skip-client.`)
    }
    // .macro templates plus every .md prompt (RP_PROMPT, SCENARIO_AGENT, …).
    // Matched by extension rather than by name: a prompt added later would
    // otherwise work in dev, be silently absent from the binary, and leave the
    // agent it belongs to running with no instructions at all.
    const promptFiles = fs.readdirSync(PROMPTS).filter(f => f.endsWith('.macro') || f.endsWith('.md'))

    const entries: BlobEntry[] = [
        ...clientFiles.map(f => ({
            key: `client/${f.replaceAll('\\', '/')}`,
            bytes: fs.readFileSync(path.join(DIST, f)),
        })),
        ...promptFiles.map(f => ({
            key: `prompt/${f}`,
            bytes: fs.readFileSync(path.join(PROMPTS, f)),
        })),
        ...natives.map(n => ({ key: `native/${n.name}`, bytes: fs.readFileSync(n.src) })),
    ]

    console.log(`› packing ${clientFiles.length} client files, ${promptFiles.length} prompts, ${natives.length} natives`)
    return packBlob(entries)
}

// ── Plugin ──────────────────────────────────────────────────────────────────

const sharpShim: BunPlugin = {
    name: 'sharp-native-shim',
    setup(build) {
        build.onLoad({ filter: /sharp[\\/]lib[\\/]sharp\.js$/ }, () => ({
            loader: 'js',
            contents: [
                "const path = require('node:path')",
                `module.exports = require(path.join(process.env.FREEDUNGEON_NATIVE_DIR, ${JSON.stringify(SHARP_BINDING)}))`,
            ].join('\n'),
        }))
    },
}

/**
 * Rewrites just the binding require in onnxruntime-node's loader, leaving the
 * rest of the module (initOrt and its log-level handling) intact.
 */
const onnxShim: BunPlugin = {
    name: 'onnx-native-shim',
    setup(build) {
        build.onLoad({ filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ }, (args) => {
            const source = fs.readFileSync(args.path, 'utf8')
            const dynamicRequire = /require\(`[^`]*onnxruntime_binding\.node`\)/
            if (!dynamicRequire.test(source)) {
                throw new Error(
                    `onnxruntime-node's binding require no longer matches (${args.path}). ` +
                    'Its loader changed — update this shim.',
                )
            }
            return {
                loader: 'js',
                contents: source.replace(
                    dynamicRequire,
                    "require(require('node:path').join(process.env.FREEDUNGEON_NATIVE_DIR, 'onnxruntime_binding.node'))",
                ),
            }
        })
    },
}

// ── Build ───────────────────────────────────────────────────────────────────

if (!skipClient) {
    console.log('› building client')
    const vite = Bun.spawnSync(['bun', 'run', 'build'], {
        cwd: path.join(REPO, 'client'),
        stdout: 'inherit',
        stderr: 'inherit',
    })
    if (vite.exitCode !== 0) process.exit(vite.exitCode ?? 1)
}

const natives = [...findSharpNatives(), ...findOnnxNatives()]
const totalMb = natives.reduce((sum, n) => sum + fs.statSync(n.src).size, 0) / 1e6
console.log(`› embedding ${natives.length} native files (${totalMb.toFixed(0)}MB):`, natives.map(n => n.name).join(', '))

fs.mkdirSync(OUT_DIR, { recursive: true })
const blob = buildAssetBlob(natives)
// entry.ts imports this path literally, so the name is part of the contract.
fs.writeFileSync(path.join(OUT_DIR, 'assets.blob'), blob)
const rawMb = natives.reduce((s, n) => s + fs.statSync(n.src).size, 0) / 1e6
console.log(`› assets.blob ${(blob.length / 1e6).toFixed(1)}MB (from ~${rawMb.toFixed(0)}MB natives + client)`)

const outfile = path.join(OUT_DIR, 'freedungeon.exe')
const result = await Bun.build({
    entrypoints: [path.join(ROOT, 'src', 'entry.ts')],
    target: 'bun',
    plugins: [sharpShim, onnxShim],
    compile: {
        target: 'bun-windows-x64',
        outfile,
        // Bun rejects a PNG here ("image type is not icon"). logo.ico holds
        // 16/24/32/48/64/96 so Windows never has to rescale.
        windows: { title: 'freedungeon', icon: path.join(REPO, 'client', 'public', 'logo.ico') },
    } as any,
})

if (!result.success) {
    console.error(result.logs.map(String).join('\n'))
    process.exit(1)
}
console.log(`› ${path.relative(REPO, outfile)}  ${(fs.statSync(outfile).size / 1e6).toFixed(0)}MB`)

// ── Desktop shell ───────────────────────────────────────────────────────────

if (!skipDesktop) {
    await buildDesktopShell(outfile)
}

/**
 * Build the Tauri shell with the backend baked into it.
 *
 * The backend stays a separate process — it's a Bun binary with its own
 * embedded assets and a `bun:sqlite` dependency, so it can't be hosted inside
 * the shell — but it's embedded as bytes rather than shipped beside the exe,
 * so distribution is still one file. The shell writes it out on first run.
 *
 * `include_bytes!` needs a literal path at compile time, hence the env var:
 * `env!()` resolves to a literal, and build.rs re-runs when either changes.
 */
async function buildDesktopShell(backend: string) {
    const crate = path.join(REPO, 'desktop', 'src-tauri')
    if (!fs.existsSync(crate)) {
        console.log('› no desktop/ crate, skipping shell')
        return
    }

    // Identifies this exact backend build, so an upgraded shell replaces the
    // copy a previous version extracted instead of reusing it.
    const stamp = Bun.hash(fs.readFileSync(backend)).toString(16)

    const proc = Bun.spawn(['cargo', 'build', '--release'], {
        cwd: crate,
        env: {
            ...process.env,
            FREEDUNGEON_BACKEND: backend,
            FREEDUNGEON_BACKEND_STAMP: stamp,
        },
        stdout: 'inherit',
        stderr: 'inherit',
    })
    if (await proc.exited !== 0) {
        console.error('cargo build failed')
        process.exit(1)
    }

    const built = path.join(crate, 'target', 'release', 'freedungeon-desktop.exe')
    const shipped = path.join(OUT_DIR, 'freedungeon-desktop.exe')
    fs.copyFileSync(built, shipped)
    console.log(`› ${path.relative(REPO, shipped)}  ${(fs.statSync(shipped).size / 1e6).toFixed(0)}MB`)
}
