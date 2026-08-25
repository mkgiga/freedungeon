import { Show, type JSXElement } from 'solid-js'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'

/**
 * The building blocks every settings pane is made of.
 *
 * A group titles a set of related rows, a row titles one control, a hint
 * explains it. Three levels, nothing else competes - hierarchy comes from the
 * components rather than being reapplied at each call site.
 */

/** A titled set of related rows. */
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

/**
 * A labelled control that sits below its label — pickers, inputs, anything
 * wide. `hint` goes under the control, where it reads as a footnote rather than
 * as a subtitle competing with the label.
 */
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

/**
 * A checkbox with its label and explanation. The whole row is the hit target —
 * a 13px checkbox is a poor one, and the label was already inside the <label>.
 */
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

/** Text/password input styled to match the pickers. */
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
