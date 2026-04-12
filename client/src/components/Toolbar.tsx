import type { JSXElement } from 'solid-js'
import styles from './Toolbar.module.css'

export interface ToolbarProps {
    children?: JSXElement;
    height?: string;
    slots?: {
        left?: JSXElement;
        center?: JSXElement;
        right?: JSXElement;
    };
}

export const Toolbar = (props: ToolbarProps) => {
    return (
        <div class={styles.toolbar} style={{ height: props.height || '60px' }}>
            <div class={styles['toolbar-left']}>
                {props.slots?.left}
                {props.children}
            </div>
            <div class={styles['toolbar-center']}>
                {props.slots?.center}
            </div>
            <div class={styles['toolbar-right']}>
                {props.slots?.right}
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