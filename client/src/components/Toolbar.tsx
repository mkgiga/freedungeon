import { splitProps, type JSX, type JSXElement } from 'solid-js'
import styles from './Toolbar.module.css'

/**
 * Extends all intrinsic `<div>` attributes; anything you'd put on a raw div
 * passes through to the outer container.
 *
 * `class` merges with `styles.toolbar` and `style` merges with the `height`
 * defaults, so passthrough doesn't clobber the baseline appearance.
 */
export interface ToolbarProps extends JSX.HTMLAttributes<HTMLDivElement> {
    height?: string;
    slots?: {
        left?: JSXElement;
        center?: JSXElement;
        right?: JSXElement;
    };
}

export const Toolbar = (props: ToolbarProps) => {
    const [local, rest] = splitProps(props, ['height', 'slots', 'children', 'class', 'style'])

    const mergedClass = () => [styles.toolbar, local.class].filter(Boolean).join(' ')

    const mergedStyle = () => {
        const base = { height: local.height || '60px' } as Record<string, string>
        if (local.style && typeof local.style === 'object') {
            return { ...base, ...(local.style as Record<string, string>) }
        }
        return base
    }

    return (
        <div {...rest} class={mergedClass()} style={mergedStyle()}>
            <div class={styles['toolbar-left']}>
                {local.slots?.left}
                {local.children}
            </div>
            <div class={styles['toolbar-center']}>
                {local.slots?.center}
            </div>
            <div class={styles['toolbar-right']}>
                {local.slots?.right}
            </div>
        </div>
    );
};

export const ToolbarButton = (props: { onClick: () => void; children: JSXElement }) => {
    return (
        <button class={styles.toolbarButton} onClick={props.onClick}>
            {props.children}
        </button>
    );
}