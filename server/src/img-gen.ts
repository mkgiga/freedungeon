// Image generation — stable-diffusion.cpp sidecar provider.
//
// Replaces a provider that talked to a Stable Diffusion WebUI Forge server the
// user had to install, configure and run themselves. The model now arrives as a
// managed dependency and the server is our own child process, so there is no
// endpoint to configure and no "is it running?" for anyone to answer.
//
// The wire protocol is sd.cpp's native async API (`/sdcpp/v1`) rather than its
// A1111-compatible surface. The compatibility route would have been a smaller
// diff, but it is synchronous — and async submit-then-poll is exactly the shape
// the old code faked with Forge's `force_task_id` and `/internal/progress`.

import { log } from './logger';
import { SD_URL, ensureSdServer } from './sd/server';

export interface GenerationOptions {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    /** -1 (the default) lets the sampler pick a random seed. */
    seed?: number;
    samplerName?: string;
    scheduler?: string;
    /**
     * Caller-supplied correlation id, so progress for *this* request can be
     * looked up while it runs. sd-server mints its own job id, so this maps onto
     * that one — see `jobs` below.
     */
    taskId?: string;
    /** Escape hatch: extra raw fields merged into the request body. */
    raw?: Record<string, unknown>;
    signal?: AbortSignal;
}

export interface GeneratedImage {
    png: Uint8Array;
    seed: number;
}

export interface GenerationResult {
    images: GeneratedImage[];
    /** Echoed generation parameters, for debugging and metadata. */
    info: Record<string, any>;
}

export interface TaskProgress {
    active: boolean;
    queued: boolean;
    completed: boolean;
    /**
     * Always null. sd-server reports a job's *state* and its queue position but
     * no completion fraction — there is no per-step signal on its HTTP surface.
     * Kept in the shape so a caller rendering a bar can show an indeterminate
     * one, rather than every caller growing a special case.
     */
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

/** Caller correlation id -> sd-server job id, for in-flight requests only. */
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

    // Lazy: the weights are only paid for once something actually asks for an
    // image, and the first call absorbs the model load.
    await ensureSdServer();

    const body = {
        prompt: opts.prompt,
        negative_prompt: opts.negativePrompt ?? '',
        width: opts.width ?? 1024,
        height: opts.height ?? 1024,
        seed: opts.seed ?? -1,
        batch_count: 1,
        sample_params: {
            sample_steps: opts.steps ?? 20,
            sample_method: opts.samplerName ?? 'euler',
            scheduler: opts.scheduler ?? 'discrete',
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
            // sd-server doesn't echo a resolved seed per image. A caller that
            // pinned one already knows it; -1 means it was never pinned.
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

/** Progress for one in-flight request, by the caller's own correlation id. */
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

/** Stop whatever is generating right now. */
export async function interrupt(): Promise<void> {
    await Promise.all([...jobs.values()].map(cancelJob));
}

/** Whether the image server is answering. */
export async function ping(): Promise<boolean> {
    try {
        await sd('/sdcpp/v1/capabilities');
        return true;
    } catch {
        return false;
    }
}
