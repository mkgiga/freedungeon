import type { JSXElement } from "solid-js"

export type Action = {
    label: string
    icon?: JSXElement
    onClick: () => void
    danger?: boolean
    disabled?: boolean
}
