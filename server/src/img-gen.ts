
import { log } from './logger';
import { SD_URL, ensureSdServer } from './sd/server';

export interface GenerationOptions {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    seed?: number;
    samplerName?: string;
    scheduler?: string;
    taskId?: string;
    raw?: Record<string, unknown>;
    signal?: AbortSignal;
}

export interface GeneratedImage {
    png: Uint8Array;
    seed: number;
}

export interface GenerationResult {
    images: GeneratedImage[];
    info: Record<string, any>;
}

export interface TaskProgress {
    active: boolean;
    queued: boolean;
    completed: boolean;
    progress: number | null;
    etaSeconds: number | null;
}

type SdJob = {
    id: string;
    status: 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled';
    queue_position?: number;
    result?: { output_format?: string; images?: { index: number; b64_json: string }[] } | null;
    error?: { code?: string; message?: string } | null;
};

const jobs = new Map<string, string>();

async function sd(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${SD_URL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`sd-server ${res.status} on ${path}${body ? `: ${body.slice(0, 300)}` : ''}`);
    }
    return res.json();
}

export async function generateImage(options: string | GenerationOptions): Promise<GenerationResult> {
    const opts: GenerationOptions = typeof options === 'string' ? { prompt: options } : options;

    await ensureSdServer();

    const body = {
        prompt: opts.prompt,
        negative_prompt: opts.negativePrompt ?? '',
        width: opts.width ?? 1024,
        height: opts.height ?? 1024,
        seed: opts.seed ?? -1,
        batch_count: 1,
        sample_params: {
            sample_steps: opts.steps ?? 30,
            sample_method: opts.samplerName ?? 'euler',
            scheduler: opts.scheduler ?? 'ER-SDE',
            guidance: { txt_cfg: opts.cfgScale ?? 6.0 },
        },
        output_format: 'png',
        ...(opts.raw ?? {}),
    };

    const submitted = await sd('/sdcpp/v1/img_gen', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: opts.signal,
    }) as SdJob;

    if (opts.taskId) jobs.set(opts.taskId, submitted.id);
    try {
        const job = await pollUntilSettled(submitted.id, opts.signal);
        if (job.status !== 'completed') {
            throw new Error(job.error?.message ?? `Image job ${job.status}`);
        }
        const images = (job.result?.images ?? []).map((img) => ({
            png: Buffer.from(img.b64_json, 'base64'),
            seed: opts.seed ?? -1,
        }));
        return { images, info: { jobId: job.id, request: body } };
    } finally {
        if (opts.taskId) jobs.delete(opts.taskId);
    }
}

async function pollUntilSettled(id: string, signal?: AbortSignal): Promise<SdJob> {
    for (;;) {
        if (signal?.aborted) {
            void cancelJob(id);
            throw new Error('Image generation aborted');
        }
        const job = await sd(`/sdcpp/v1/jobs/${id}`) as SdJob;
        if (job.status !== 'queued' && job.status !== 'generating') return job;
        await new Promise(r => setTimeout(r, 400));
    }
}

export async function getTaskProgress(taskId: string): Promise<TaskProgress | null> {
    const id = jobs.get(taskId);
    if (!id) return null;
    try {
        const job = await sd(`/sdcpp/v1/jobs/${id}`) as SdJob;
        return {
            active: job.status === 'generating',
            queued: job.status === 'queued',
            completed: job.status === 'completed',
            progress: null,
            etaSeconds: null,
        };
    } catch {
        return null;
    }
}

async function cancelJob(id: string): Promise<void> {
    try {
        await sd(`/sdcpp/v1/jobs/${id}/cancel`, { method: 'POST' });
    } catch (err) {
        log.server.warn(`Could not cancel image job ${id}: ${err instanceof Error ? err.message : err}`);
    }
}

export async function interrupt(): Promise<void> {
    await Promise.all([...jobs.values()].map(cancelJob));
}

export async function ping(): Promise<boolean> {
    try {
        await sd('/sdcpp/v1/capabilities');
        return true;
    } catch {
        return false;
    }
}
