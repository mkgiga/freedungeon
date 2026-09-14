import { children, createSignal, Show, type JSX } from 'solid-js'
import { MdFillFlip, MdFillUpload } from 'solid-icons/md'
import { AnchoredMenu, type DropdownItem } from './Dropdown'
import { pickImage } from '../utils/imageUpload'
import { trpc } from '../trpc'

/**
 * Wraps any image to give it a menu: replace it, or mirror it.
 *
 * `display: contents` means this adds no box of its own, so wrapping an image
 * cannot disturb the layout around it — the same constraint that made
 * `AnchoredMenu` exist in the first place, and what lets the wrapper go around
 * a grid cell, a flex child or a floated portrait without special-casing any
 * of them.
 *
 * Because it generates no box it also has no rect, so the menu anchors to the
 * wrapped element rather than to this wrapper. Anchoring to the wrapper would
 * have meant relying on the nearest positioned ancestor, which differs at every
 * call site and is exactly the fragility this is meant to avoid. Events still
 * bubble normally: `display: contents` removes the box, not the element.
 */
export function EditableImage(props: {
    /** Current image, if any. Absent means there is nothing to flip yet. */
    url?: string
    onChange: (url: string) => void
    children: JSX.Element
}) {
    const resolved = children(() => props.children)
    const [anchor, setAnchor] = createSignal<HTMLElement | null>(null)

    const wrapped = () =>
        resolved.toArray().find((n): n is HTMLElement => n instanceof HTMLElement) ?? null

    const items = (): DropdownItem[] => {
        const list: DropdownItem[] = [{
            label: props.url ? 'Replace image' : 'Upload image',
            icon: <MdFillUpload size={16} />,
            onClick: async () => {
                const url = await pickImage()
                if (url) props.onChange(url)
            },
        }]

        // Nothing to mirror until there is an image.
        if (props.url) {
            list.push({
                label: 'Flip image',
                icon: <MdFillFlip size={16} />,
                onClick: async () => {
                    // The server repoints every stored reference to the old
                    // image; this only moves an unsaved draft along with it.
                    const { url } = await trpc.images.flip.mutate({ url: props.url! })
                    if (url) props.onChange(url)
                },
            })
        }

        return list
    }

    return (
        <div
            style={{ display: 'contents' }}
            onClick={() => setAnchor(prev => (prev ? null : wrapped()))}
        >
            {resolved()}
            <Show when={anchor()}>
                {(el) => (
                    <AnchoredMenu
                        anchor={el()}
                        items={items()}
                        onClose={() => setAnchor(null)}
                    />
                )}
            </Show>
        </div>
    )
}
