import { For, Show } from 'solid-js'
import { MdFillDownload, MdFillWarning } from 'solid-icons/md'
import { trpc } from '../trpc'
import { useModal } from './Modal'
import { Text } from './typography/Text'
import { Em } from './typography/Em'

const gb = (bytes: number) => `${(bytes / 1_073_741_824).toFixed(2)} GB`
const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`

/**
 * Confirms the image-generation download before it starts: what's missing, what
 * each piece is for, the total. It runs to gigabytes.
 *
 * Sizes come from the server - the GPU decides whether a CUDA runtime is on the
 * list, and a partly-fetched file only owes its remainder.
 */
export function useImageGenConsent() {
    const modal = useModal()

    return async (): Promise<boolean> => {
        const plan = await trpc.preferences.imageGenPlan.query()

        if (!plan.supported) {
            return new Promise<boolean>((resolve) => {
                modal.open({
                    title: plan.title ?? 'Not supported',
                    content: () => (
                        <div class="flex flex-col gap-3">
                            <div class="extension-error">
                                <MdFillWarning size={16} />
                                <Text size="sm">{plan.message}</Text>
                            </div>
                            <div class="modal-confirm-actions">
                                <button class="modal-btn modal-btn-cancel" onClick={() => { modal.close(); resolve(false) }}>
                                    OK
                                </button>
                            </div>
                        </div>
                    ),
                })
            })
        }

        if (plan.items.length === 0) return true

        const total = plan.items.reduce((n, i) => n + i.bytes, 0)
        const resuming = plan.items.some(i => i.status === 'corrupt')

        return new Promise<boolean>((resolve) => {
            modal.open({
                title: 'Download the image generator?',
                content: () => (
                    <div class="flex flex-col gap-3">
                        <Text size="sm">
                            Images are generated on this machine, so the model has to be here.
                            These files download once and are kept:
                        </Text>

                        <div class="download-plan">
                            <For each={plan.items}>
                                {(item) => (
                                    <div class="download-plan-row">
                                        <span class="download-plan-label">
                                            <Text><Em semibold>{item.label}</Em></Text>
                                            <Text size="sm" class="opacity-60">{item.reason}</Text>
                                        </span>
                                        <Text size="sm" class="download-plan-size">
                                            {item.bytes > 0 ? mb(item.bytes) : '—'}
                                        </Text>
                                    </div>
                                )}
                            </For>
                            <div class="download-plan-row download-plan-total">
                                <Text><Em bold>Total</Em></Text>
                                <Text><Em bold>{gb(total)}</Em></Text>
                            </div>
                        </div>

                        <Show when={resuming}>
                            <Text size="sm" class="opacity-60">
                                Some of this was already downloaded and will resume where it left off.
                            </Text>
                        </Show>

                        <Text size="sm" class="opacity-60">
                            You can close the app during the download — it picks up where it stopped.
                        </Text>

                        <div class="modal-confirm-actions">
                            <button class="modal-btn modal-btn-cancel" onClick={() => { modal.close(); resolve(false) }}>
                                Cancel
                            </button>
                            <button
                                class="modal-btn modal-btn-confirm"
                                onClick={() => { modal.close(); resolve(true) }}
                            >
                                <MdFillDownload size={16} /> Download {gb(total)}
                            </button>
                        </div>
                    </div>
                ),
            })
        })
    }
}
