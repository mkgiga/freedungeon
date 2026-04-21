
type GlobalGenerationParams = {
    model: string;
    prompt: string;
    cfgScale: number;
    steps: number;
    width: number;
    height: number;
    sampler: string;
    scheduler: string;
    seed: number;
};

type SDXLGenerationParams = GlobalGenerationParams & {
    // models like flux don't support a negative prompt.
    negativePrompt: string;
}

type AnimaGenerationParams = SDXLGenerationParams & {
    // not sure what this is, but the anima authors recommends setting it between 6-12.
    shift: number;
};

/** A client for generating images with a stable-diffusion-webui-forge server's REST API. */
export class SDForgeClient {
    
    private pendingJobs: Map<string, {
        abortController: AbortController;
        promise: Promise<string>;
    }> = new Map();

    private apiUrl: string;
    constructor(apiUrl: string) {
        this.apiUrl = apiUrl;
    }

    async getProgressOfJob(jobId: string): Promise<{ progress: number; eta: number } | null> {
        const job = this.pendingJobs.get(jobId);
        if (!job) {
            return null;
        }

        const response = await fetch(`${this.apiUrl}/progress/${jobId}`);
        
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json() as { progress: number; eta: number };
        console.log(`Progress for job ${jobId}: ${data.progress * 100}% complete, ETA: ${data.eta} seconds`);
        
        return data || null;
    }

    async generateImage(params: SDXLGenerationParams) {

    }

    async getPreviewOfJob(jobId: string) {

    }

}