
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
const skipDesktop = process.argv.includes('--skip-desktop')

type Native = { src: string; name: string }

const PLATFORM = `${process.platform}-${process.arch}`
const SHARP_BINDING = `sharp-${PLATFORM}.node`

function findSharpNatives(): Native[] {
    const pkg = `@img/sharp-${PLATFORM}`
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
    return nativeFilesIn(dir)
}

function nativeFilesIn(dir: string): Native[] {
    return fs.readdirSync(dir)
        .filter(f => /\.(node|dll|so|dylib)$/.test(f))
        .map(f => ({ src: path.join(dir, f), name: f }))
}

function findOnnxNatives(): Native[] {
    const dir = path.join(
        path.dirname(Bun.resolveSync('onnxruntime-node', ROOT)), '..',
        'bin', 'napi-v6', process.platform, process.arch,
    )
    if (!fs.existsSync(dir)) {
        throw new Error(`No onnxruntime-node binding for ${PLATFORM} at ${dir}. Run \`bun install\` first.`)
    }
    const dmlOnly = /^(DirectML|dxcompiler|dxil)\.dll$/i
    return nativeFilesIn(dir).filter(n => !dmlOnly.test(n.name))
}

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter(e => e.isFile())
        .map(e => path.relative(dir, path.join(e.parentPath, e.name)))
}

function buildAssetBlob(natives: Native[]): Uint8Array {
    const clientFiles = fs.existsSync(DIST) ? walk(DIST) : []
    if (clientFiles.length === 0) {
        throw new Error(`No client build at ${DIST}. Run without --skip-client.`)
    }
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
fs.writeFileSync(path.join(OUT_DIR, 'assets.blob'), blob)
const rawMb = natives.reduce((s, n) => s + fs.statSync(n.src).size, 0) / 1e6
console.log(`› assets.blob ${(blob.length / 1e6).toFixed(1)}MB (from ~${rawMb.toFixed(0)}MB natives + client)`)

const outfile = path.join(OUT_DIR, 'freedungeon.exe')

function checkOutfileWritable() {
    for (const dir of new Set([process.cwd(), OUT_DIR])) {
        for (const name of fs.readdirSync(dir)) {
            if (name.endsWith('.bun-build')) fs.rmSync(path.join(dir, name), { force: true })
        }
    }
    if (!fs.existsSync(outfile)) return
    try {
        fs.closeSync(fs.openSync(outfile, 'r+'))
    } catch {
        console.error(`✗ ${path.relative(REPO, outfile)} is in use — close the running freedungeon and try again.`)
        process.exit(1)
    }
}
checkOutfileWritable()

const result = await Bun.build({
    entrypoints: [path.join(ROOT, 'src', 'entry.ts')],
    target: 'bun',
    plugins: [sharpShim, onnxShim],
    compile: {
        target: 'bun-windows-x64',
        outfile,
        windows: { title: 'freedungeon', icon: path.join(REPO, 'client', 'public', 'logo.ico') },
    } as any,
})

if (!result.success) {
    console.error(result.logs.map(String).join('\n'))
    process.exit(1)
}
console.log(`› ${path.relative(REPO, outfile)}  ${(fs.statSync(outfile).size / 1e6).toFixed(0)}MB`)

if (!skipDesktop) {
    await buildDesktopShell(outfile)
}

async function buildDesktopShell(backend: string) {
    const crate = path.join(REPO, 'desktop', 'src-tauri')
    if (!fs.existsSync(crate)) {
        console.log('› no desktop/ crate, skipping shell')
        return
    }

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
