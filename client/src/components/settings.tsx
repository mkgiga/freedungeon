import { Show, type JSXElement } from 'solid-js'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'


export function SettingsGroup(props: { title?: string; children: JSXElement }) {
    return (
        <section class="settings-group">
            <Show when={props.title}>
                <Heading level={3} class="settings-group-title">{props.title}</Heading>
            </Show>
            <div class="settings-group-body">{props.children}</div>
        </section>
    )
}

export function SettingsField(props: { label: string; hint?: string; children: JSXElement }) {
    return (
        <div class="settings-field">
            <Text size="sm" class="settings-label">{props.label}</Text>
            {props.children}
            <Show when={props.hint}>
                {(hint) => <Text size="sm" class="settings-hint">{hint()}</Text>}
            </Show>
        </div>
    )
}

export function SettingsToggle(props: {
    label: string
    hint?: string
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
}) {
    return (
        <label class="settings-toggle" classList={{ 'is-disabled': props.disabled }}>
            <input
                type="checkbox"
                class="settings-toggle-input"
                checked={props.checked}
                disabled={props.disabled}
                onChange={(e) => props.onChange(e.currentTarget.checked)}
            />
            <span class="settings-toggle-text">
                <Text class="settings-toggle-label">{props.label}</Text>
                <Show when={props.hint}>
                    {(hint) => <Text size="sm" class="settings-hint">{hint()}</Text>}
                </Show>
            </span>
        </label>
    )
}

export function SettingsInput(props: {
    value: string
    onInput: (v: string) => void
    placeholder?: string
    type?: 'text' | 'password'
    mono?: boolean
    ref?: (el: HTMLInputElement) => void
}) {
    return (
        <input
            ref={props.ref}
            type={props.type ?? 'text'}
            class="settings-input"
            classList={{ 'font-mono': props.mono }}
            value={props.value}
            placeholder={props.placeholder}
            onInput={(e) => props.onInput(e.currentTarget.value)}
        />
    )
}
