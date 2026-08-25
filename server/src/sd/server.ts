import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { MODELS_DIR } from '../paths'
import { log } from '../logger'
import { isSatisfied } from '../dependencies'
import { SD_DIR, getSdBuildChoice } from './dependency'
import { SD_MODELS } from './manifest'
import { nvidiaVramGiB, sdRuntimeFlags } from './backend'
import type { DependencyKey } from '@shared/dependencies'

const SD_HOST = '127.0.0.1'
const SD_PORT = Number(process.env.FREEDUNGEON_SD_PORT) || 8077

export const SD_URL = `http://${SD_HOST}:${SD_PORT}`

/** Files that must be present before the sidecar can start. */
export function requiredSdDependencies(): DependencyKey[] {
    const keys: DependencyKey[] = ['sdServer', 'sdDiffusionModel', 'sdVae', 'sdTextEncoder']
    const choice = getSdBuildChoice()
    if (choice?.supported && choice.backend === 'cuda12') keys.push('sdCudaRuntime')
    return keys
}

let child: ChildProcess | null = null
let starting: Promise<void> | null = null

function executable(): string {
    return path.join(SD_DIR, process.platform === 'win32' ? 'sd-server.exe' : 'sd-server')
}

async function isUp(): Promise<boolean> {
    try {
        const res = await fetch(`${SD_URL}/sdcpp/v1/capabilities`, {
            signal: AbortSignal.timeout(1500),
        })
        return res.ok
    } catch {
        return false
    }
}

/**
 * Start the sidecar if it isn't running, and resolve once it answers.
 *
 * Concurrent callers share one attempt so two turns can't race two processes
 * onto the same port. Readiness is a real request, not "the process didn't
 * exit" - sd-server binds its port only after loading ~3 GB of weights, which
 * can take a minute cold.
 */
export function ensureSdServer(): Promise<void> {
    if (starting) return starting

    starting = (async () => {
        if (child && await isUp()) return

        const choice = getSdBuildChoice()
        if (!choice) throw new Error('Image generation support has not been resolved yet.')
        if (!choice.supported) throw new Error(choice.message)

        for (const key of requiredSdDependencies()) {
            if (!await isSatisfied(key)) throw new Error(`Image generation is missing ${key}.`)
        }

        if (await isUp()) {
            log.server.info(`Image server already listening on ${SD_URL}`)
            return
        }

        const flags = sdRuntimeFlags(choice.backend, await nvidiaVramGiB())
        const args = [
            '--diffusion-model', path.join(MODELS_DIR, SD_MODELS.diffusion.file),
            '--vae', path.join(MODELS_DIR, SD_MODELS.vae.file),
            '--llm', path.join(MODELS_DIR, SD_MODELS.textEncoder.file),
            '--listen-ip', SD_HOST,
            '--listen-port', String(SD_PORT),
            ...flags,
        ]

        log.server.info(`Starting image server (${choice.why}) ${flags.join(' ')}`)
        const proc = spawn(executable(), args, { cwd: SD_DIR, windowsHide: true })
        child = proc

        let tail = ''
        const keep = (buf: Buffer) => { tail = (tail + buf.toString()).slice(-4000) }
        proc.stdout?.on('data', keep)
        proc.stderr?.on('data', keep)

        let exited: string | null = null
        proc.on('exit', (code, signal) => {
            exited = `exited with ${signal ?? code}`
            if (child === proc) child = null
        })
        proc.on('error', (err) => { exited = err.message })

        const deadline = Date.now() + 180_000
        while (Date.now() < deadline) {
            if (exited) throw new Error(`Image server ${exited}\n${tail.trim().slice(-600)}`)
            if (await isUp()) {
                log.server.ok(`Image server ready on ${SD_URL}`)
                return
            }
            await new Promise(r => setTimeout(r, 500))
        }

        stopSdServer()
        throw new Error('Image server did not become ready within 3 minutes.')
    })().finally(() => { starting = null })

    return starting
}

/**
 * Stop the sidecar, releasing the weights it is holding resident.
 *
 * Called when the feature is switched off and on shutdown. The process holds
 * gigabytes for as long as it lives, so leaving it running "just in case" is
 * not free the way an idle HTTP server would be.
 */
export function stopSdServer(): void {
    if (!child) return
    log.server.info('Stopping image server')
    child.kill()
    child = null
}

export function sdServerRunning(): boolean {
    return child !== null
}
