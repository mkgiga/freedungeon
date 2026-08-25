import { createSignal } from 'solid-js'

export async function uploadImage(file: File): Promise<string | null> {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/uploads', { method: 'POST', body: formData })
    return res.ok ? ((await res.json()).url as string) : null
}

export function pickImage(): Promise<string | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = async () => {
            const file = input.files?.[0]
            resolve(file ? await uploadImage(file) : null)
        }
        input.click()
    })
}

const imageOf = (transfer: DataTransfer | null) =>
    Array.from(transfer?.files ?? []).find(f => f.type.startsWith('image/')) ?? null

const carriesImage = (transfer: DataTransfer | null) =>
    Array.from(transfer?.items ?? []).some(i => i.kind === 'file' && i.type.startsWith('image/'))

/**
 * Only reacts to drags actually carrying an image, so dragging text or one of
 * the app's own items across an avatar doesn't light it up.
 */
export function createImageDrop(onUrl: (url: string) => void, enabled?: () => boolean) {
    const [over, setOver] = createSignal(false)
    const active = () => enabled?.() ?? true

    return {
        over,
        handlers: {
            onDragOver: (e: DragEvent) => {
                if (!active() || !carriesImage(e.dataTransfer)) return
                e.preventDefault()
                setOver(true)
            },
            onDragLeave: (e: DragEvent) => {
                const to = e.relatedTarget as Node | null
                if (to && (e.currentTarget as HTMLElement).contains(to)) return
                setOver(false)
            },
            onDrop: async (e: DragEvent) => {
                if (!active()) return
                e.preventDefault()
                setOver(false)
                const file = imageOf(e.dataTransfer)
                if (!file) return
                const url = await uploadImage(file)
                if (url) onUrl(url)
            },
        },
    }
}

/**
 * Dropping a file anywhere the page doesn't handle makes the browser open it,
 * discarding whatever was on screen - including an unsaved editor.
 */
export function guardStrayImageDrops() {
    const swallow = (e: DragEvent) => {
        if (!carriesImage(e.dataTransfer)) return
        e.preventDefault()
    }
    document.addEventListener('dragover', swallow)
    document.addEventListener('drop', swallow)
}
