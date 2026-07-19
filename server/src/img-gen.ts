// image generation module — Stable Diffusion WebUI Forge provider
//
// Forge quirk: txt2img is a blocking call and the server runs one job at a
// time with a single global /progress endpoint (no per-job ids).

const FORGE_URL = (process.env.FORGE_URL || 'http://localhost:7860').replace(/\/+$/, '');

export interface GenerationOptions {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    /** -1 (default) lets Forge pick a random seed */
    seed?: number;
    samplerName?: string;
    scheduler?: string;
    /** images generated in one GPU pass */
    batchSize?: number;
    /** sequential passes (total images = batchSize * batches) */
    batches?: number;
    /** checkpoint name; only sent to Forge when it differs from what's loaded */
    checkpoint?: string;
    /** Forge UI preset (sd/xl/flux/...); only sent on change */
    forgePreset?: string;
    /** VAE / text-encoder module basenames or paths; only sent on change */
    modules?: string[];
    /** extra override_settings, e.g. { CLIP_stop_at_last_layers: 2 } */
    overrideSettings?: Record<string, unknown>;
    /** escape hatch: extra raw fields merged into the txt2img payload */
    raw?: Record<string, unknown>;
    signal?: AbortSignal;
}

export interface GeneratedImage {
    png: Uint8Array;
    seed: number;
}

export interface GenerationResult {
    images: GeneratedImage[];
    /** generation parameters echoed by Forge (all_seeds, sampler, model hash, ...) */
    info: Record<string, any>;
}

export interface GenerationProgress {
    /** 0..1 */
    progress: number;
    etaSeconds: number;
    currentStep: number;
    totalSteps: number;
}

export interface LoraInfo {
    name: string;
    /** human-readable training output name when available */
    alias: string;
    path?: string;
    /** activation words mined from training metadata; may be empty */
    triggers: string[];
    baseModel?: string;
}

async function forge<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${FORGE_URL}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...init,
    });
    if (!res.ok) {
        throw new Error(`Forge ${path} responded ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
}

/** A1111-style LoRA prompt tag, e.g. `lora('rpgmaker-xp', 0.8)` -> `<lora:rpgmaker-xp:0.8>` */
export function lora(name: string, weight = 1): string {
    return `<lora:${name}:${weight}>`;
}

// ---------------------------------------------------------------------------
// Loaded-model tracking. Sending sd_model_checkpoint / forge_preset /
// forge_additional_modules in override_settings forces an expensive model
// reload, so we only include them when they differ from what Forge already has
// loaded (seeded once from live options). Together with
// override_settings_restore_afterwards: false this keeps the model resident
// between jobs instead of reloading it on every generation.
// ---------------------------------------------------------------------------

let seeded = false;
let appliedCheckpoint: string | undefined;
let appliedPreset: string | undefined;
let appliedModules: string[] | undefined;
/** module basename -> absolute path, from /sdapi/v1/sd-modules */
let moduleCache: Map<string, string> | null = null;
let loraCache: LoraInfo[] | null = null;

async function ensureModelSeed(): Promise<void> {
    if (seeded) return;
    seeded = true;
    try {
        const o = await forge<Record<string, unknown>>('/sdapi/v1/options');
        if (typeof o.sd_model_checkpoint === 'string') appliedCheckpoint = o.sd_model_checkpoint;
        if (typeof o.forge_preset === 'string') appliedPreset = o.forge_preset;
        if (Array.isArray(o.forge_additional_modules)) {
            appliedModules = o.forge_additional_modules as string[];
        }
    } catch {
        // leave unseeded values; overrides will just be sent unconditionally
    }
}

/**
 * Resolve module basenames (e.g. "qwen_image_vae.safetensors") to the absolute
 * paths Forge wants in forge_additional_modules. Unmatched names pass through.
 */
async function resolveModules(names: string[]): Promise<string[]> {
    if (names.length === 0) return [];
    if (!moduleCache) {
        moduleCache = new Map();
        try {
            const list = await forge<{ filename?: string }[]>('/sdapi/v1/sd-modules');
            for (const m of list) {
                if (!m.filename) continue;
                moduleCache.set(m.filename.split(/[\\/]/).pop()!, m.filename);
            }
        } catch {
            // fall back to the given names below
        }
    }
    return names.map((n) => moduleCache!.get(n) ?? n);
}

function sameModuleSet(a: string[], b: string[] | undefined): boolean {
    if (!b || a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((x, i) => x === sb[i]);
}

async function buildOverrideSettings(opts: GenerationOptions): Promise<Record<string, unknown>> {
    await ensureModelSeed();
    const overrides: Record<string, unknown> = { ...opts.overrideSettings };
    if (opts.checkpoint && opts.checkpoint !== appliedCheckpoint) {
        overrides.sd_model_checkpoint = opts.checkpoint;
        appliedCheckpoint = opts.checkpoint;
    }
    if (opts.forgePreset && opts.forgePreset !== appliedPreset) {
        overrides.forge_preset = opts.forgePreset;
        appliedPreset = opts.forgePreset;
    }
    if (opts.modules) {
        const modules = await resolveModules(opts.modules);
        if (!sameModuleSet(modules, appliedModules)) {
            overrides.forge_additional_modules = modules;
            appliedModules = modules;
        }
    }
    return overrides;
}

export async function generateImage(options: string | GenerationOptions): Promise<GenerationResult> {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    const res = await forge<{ images?: string[]; info?: string }>('/sdapi/v1/txt2img', {
        method: 'POST',
        signal: opts.signal ?? null,
        body: JSON.stringify({
            prompt: opts.prompt,
            negative_prompt: opts.negativePrompt ?? '',
            width: opts.width ?? 512,
            height: opts.height ?? 512,
            steps: opts.steps ?? 28,
            cfg_scale: opts.cfgScale ?? 7,
            seed: opts.seed ?? -1,
            sampler_name: opts.samplerName,
            scheduler: opts.scheduler,
            batch_size: opts.batchSize ?? 1,
            n_iter: opts.batches ?? 1,
            override_settings: await buildOverrideSettings(opts),
            // Keep the model resident between jobs (see loaded-model tracking).
            override_settings_restore_afterwards: false,
            send_images: true,
            save_images: false,
            ...opts.raw,
        }),
    });

    // info isn't always valid JSON; a parse failure must not fail the job
    let info: Record<string, any> = {};
    try {
        info = res.info ? JSON.parse(res.info) : {};
    } catch {
        /* keep {} */
    }
    const seeds: number[] = Array.isArray(info.all_seeds) ? info.all_seeds : [];
    return {
        images: (res.images ?? []).map((b64, i) => ({
            png: new Uint8Array(Buffer.from(b64, 'base64')),
            seed: seeds[i] ?? info.seed ?? -1,
        })),
        info,
    };
}

/** Progress of the currently running generation. Forge runs one job at a time. */
export async function getProgress(): Promise<GenerationProgress> {
    const res = await forge<any>('/sdapi/v1/progress?skip_current_image=true');
    return {
        progress: Math.max(0, Math.min(1, res.progress ?? 0)),
        etaSeconds: res.eta_relative ?? 0,
        currentStep: res.state?.sampling_step ?? 0,
        totalSteps: res.state?.sampling_steps ?? 0,
    };
}

/** Stop the currently running generation server-side. */
export function interrupt(): Promise<unknown> {
    return forge('/sdapi/v1/interrupt', { method: 'POST' });
}

/** Whether the Forge server is reachable. */
export async function ping(): Promise<boolean> {
    try {
        await forge('/sdapi/v1/options');
        return true;
    } catch {
        return false;
    }
}

export async function listCheckpoints(): Promise<string[]> {
    const res = await forge<{ title?: string; model_name?: string }[]>('/sdapi/v1/sd-models');
    return res.map((m) => m.model_name ?? m.title ?? '').filter(Boolean);
}

export async function listSamplers(): Promise<string[]> {
    const res = await forge<{ name?: string }[]>('/sdapi/v1/samplers');
    return res.map((s) => s.name ?? '').filter(Boolean);
}

/** LoRAs available on the server, with aliases and mined trigger words. */
export async function listLoras(): Promise<LoraInfo[]> {
    if (loraCache) return loraCache;
    const res = await forge<RawLora[]>('/sdapi/v1/loras');
    loraCache = res
        .map((raw): LoraInfo => {
            const name = raw.name ?? raw.alias ?? '';
            const meta = raw.metadata ?? {};
            return {
                name,
                alias: pickAlias(raw, meta) || name,
                path: raw.path,
                triggers: extractTriggers(meta),
                baseModel:
                    typeof meta.ss_base_model_version === 'string'
                        ? meta.ss_base_model_version
                        : undefined,
            };
        })
        .filter((l) => l.name)
        .sort((a, b) => a.alias.localeCompare(b.alias));
    return loraCache;
}

interface RawLora {
    name?: string;
    alias?: string;
    path?: string;
    metadata?: Record<string, unknown>;
}

/** Prefer the human training output name over the (often hashed) filename. */
function pickAlias(raw: RawLora, meta: Record<string, unknown>): string {
    const candidates = [meta.ss_output_name, meta['modelspec.title'], raw.alias];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
}

// Leading-token stopwords: when a LoRA was trained on natural-language captions,
// the first word of a caption is usually an article/preposition, not a trigger.
const TRIGGER_STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'of', 'in', 'on', 'with', 'to', 'is', 'are', 'at',
    'by', 'for', 'this', 'that', 'it', 'he', 'she', 'they', 'his', 'her', 'their',
    'viewed', 'from', 'as', 'or', 'but',
]);

/**
 * Mine activation/trigger words from a LoRA's safetensors training metadata
 * (kohya's ss_tag_frequency). Tag-trained LoRAs store short tags as keys;
 * caption-trained ones store whole sentences where the trigger is usually a
 * distinctive leading token. No dedicated trigger field exists, so extract
 * both shapes heuristically and rank by frequency. Returns at most 12.
 */
function extractTriggers(meta: Record<string, unknown>): string[] {
    const freq = meta.ss_tag_frequency;
    if (!freq || typeof freq !== 'object') return [];

    const whole = new Map<string, number>(); // short, clean tags
    const lead = new Map<string, number>(); // distinctive leading tokens
    const bump = (m: Map<string, number>, k: string, n: number) =>
        m.set(k, (m.get(k) ?? 0) + n);

    for (const dir of Object.values(freq as Record<string, unknown>)) {
        if (!dir || typeof dir !== 'object') continue;
        for (const [rawKey, rawCount] of Object.entries(dir as Record<string, unknown>)) {
            const key = rawKey.trim();
            if (!key) continue;
            const n = typeof rawCount === 'number' ? rawCount : 1;
            const words = key.split(/\s+/);
            if (words.length <= 3 && key.length <= 40) {
                bump(whole, key, n);
            } else {
                // Long caption: keep only a distinctive leading token (strip
                // wrapping punctuation but preserve a leading @ / # marker).
                const tok = (words[0] ?? '').replace(/^[^\p{L}\p{N}@#]+|[^\p{L}\p{N}]+$/gu, '');
                if (tok.length >= 2) bump(lead, tok, n);
            }
        }
    }

    const ranked: { t: string; n: number }[] = [];
    const seen = new Set<string>();
    const push = (t: string, n: number) => {
        const k = t.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        ranked.push({ t, n });
    };

    for (const [t, n] of whole) push(t, n);
    for (const [t, n] of lead) {
        // Explicit @/# markers are almost certainly the trigger — boost them.
        if (t.startsWith('@') || t.startsWith('#')) push(t, n + 1_000_000);
        else if (n >= 2 && !TRIGGER_STOPWORDS.has(t.toLowerCase())) push(t, n);
    }

    return ranked
        .sort((a, b) => b.n - a.n)
        .slice(0, 12)
        .map((x) => x.t);
}

export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export class ImageGenerationJob {
    private _status: JobStatus = 'pending';
    private controller = new AbortController();
    result?: GenerationResult;
    error?: unknown;

    get status() {
        return this._status;
    }

    constructor(public options: string | GenerationOptions) {}

    async start(): Promise<GenerationResult> {
        if (this._status !== 'pending') throw new Error(`job already ${this._status}`);
        this._status = 'in_progress';
        const opts = typeof this.options === 'string' ? { prompt: this.options } : this.options;
        try {
            this.result = await generateImage({ ...opts, signal: this.controller.signal });
            this._status = 'completed';
            return this.result;
        } catch (err) {
            this._status = 'failed';
            this.error = err;
            throw err;
        }
    }

    progress() {
        return getProgress();
    }

    /** Abort the request and interrupt the generation on the server. */
    async cancel() {
        this.controller.abort();
        await interrupt().catch(() => {});
    }
}
