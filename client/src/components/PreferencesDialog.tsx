import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { MdFillSmart_toy } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { useModal } from './Modal'
import { useAssetPickers } from './chat/AssetPicker'
import { useLlmConfigs } from './LlmConfigsDialog'
import { ImageIcon } from './ImageIcon'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { SchemaForm } from './json-ui'
import { SettingsField, SettingsGroup, SettingsToggle } from './settings'
import { FEATURES, resolveFeatureConfig, type FeatureKey } from '@shared/features'
import { installAvailable, isStandalone, triggerInstall } from '../pwa-install'
import { ShowOn } from './ShowOn'

/**
 * Preferences, as a dialog with a jump-nav rail.
 *
 * Every section is rendered into one scrolling container on every viewport, and
 * the rail scrolls to them rather than swapping panes. Settings are short and
 * worth skimming end to end; hiding four of five behind a click makes you hunt
 * for the one you want. The rail is a table of contents, not a router — which is
 * also why a phone can simply drop it and lose nothing.
 */

type SectionId = 'general' | 'interface' | 'features' | 'install'

export function PreferencesDialog() {
    const pickers = useAssetPickers()
    const configs = useLlmConfigs()

    const sections = (): { id: SectionId; label: string }[] => [
        { id: 'general', label: 'General' },
        { id: 'interface', label: 'Interface' },
        { id: 'features', label: 'Features' },
        ...(isStandalone() ? [] : [{ id: 'install' as const, label: 'Install' }]),
    ]

    let scroller: HTMLDivElement | undefined
    const anchors = new Map<SectionId, HTMLElement>()
    const [current, setCurrent] = createSignal<SectionId>('general')

    /**
     * Which section the reader is in: the last one whose top has passed the
     * container's top edge, plus a small offset so a heading counts as soon as
     * it's comfortably in view rather than exactly at the boundary.
     *
     * Measured on scroll rather than with an IntersectionObserver because the
     * final section is usually shorter than the viewport and can never reach the
     * top — with observers that leaves the highlight stuck on the second-to-last
     * entry no matter how far you scroll.
     */
    const OFFSET = 24
    const syncCurrent = () => {
        if (!scroller) return
        // At the very bottom the last section is current by definition, however
        // short it is.
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
        const ids = sections().map(s => s.id)
        if (atBottom) {
            const last = ids[ids.length - 1]
            if (last) setCurrent(last)
            return
        }
        const top = scroller.getBoundingClientRect().top + OFFSET
        let found: SectionId = ids[0] ?? 'general'
        for (const id of ids) {
            const el = anchors.get(id)
            if (el && el.getBoundingClientRect().top <= top) found = id
        }
        setCurrent(found)
    }

    onMount(() => {
        scroller?.addEventListener('scroll', syncCurrent, { passive: true })
        syncCurrent()
    })
    onCleanup(() => scroller?.removeEventListener('scroll', syncCurrent))

    const jumpTo = (id: SectionId) => {
        const el = anchors.get(id)
        if (!el || !scroller) return
        // `.prefs-scroll` is the sections' offsetParent (it's positioned), so
        // offsetTop is already a scroll position within it.
        scroller.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
    }

    const Section = (props: { id: SectionId; label: string; children: any }) => (
        <section
            class="prefs-section"
            ref={(el) => anchors.set(props.id, el)}
        >
            <Heading level={2} class="prefs-section-title">{props.label}</Heading>
            {props.children}
        </section>
    )

    const activeConfig = () => {
        const id = state.userPreferences.activeLLMConfigId
        return id ? state.assets.llmConfigs?.[id] ?? null : null
    }
    const playerActor = () => {
        const id = state.userPreferences.playerCharacterId
        return id ? state.assets.actors?.[id] ?? null : null
    }

    const setAutoSkip = (checked: boolean) => trpc.preferences.update.mutate({
        interface: {
            ...state.userPreferences.interface,
            chat: { ...state.userPreferences.interface?.chat, autoSkip: checked },
        },
    })

    return (
        <div class="prefs-dialog">
            <ShowOn viewport={['tablet', 'wide']}>
                <nav class="prefs-nav">
                    <For each={sections()}>
                        {(section) => (
                            <button
                                type="button"
                                class="prefs-nav-item"
                                classList={{ active: current() === section.id }}
                                onClick={() => jumpTo(section.id)}
                            >
                                {section.label}
                            </button>
                        )}
                    </For>
                </nav>
            </ShowOn>

            <div class="prefs-scroll" ref={scroller}>
                <Section id="general" label="General">
                    <SettingsGroup>
                        {/* Opens the models library rather than a separate
                            picker: it already lists every config, marks the one
                            in use and can switch to another, so a second dialog
                            that only did the switching was one screen too many. */}
                        <SettingsField label="Model">
                            <button type="button" class="settings-picker" onClick={() => configs.open()}>
                                <Show
                                    when={activeConfig()}
                                    fallback={<Text class="settings-hint">None selected</Text>}
                                >
                                    {(config) => (
                                        <>
                                            <MdFillSmart_toy size={22} class="settings-picker-icon" />
                                            <Text class="truncate">{config().name}</Text>
                                            <Text size="sm" class="settings-hint truncate">
                                                {config().model || config().provider}
                                            </Text>
                                        </>
                                    )}
                                </Show>
                            </button>
                        </SettingsField>

                        <SettingsField label="Player character">
                            <button type="button" class="settings-picker" onClick={pickers.openPlayerCharacter}>
                                <Show
                                    when={playerActor()}
                                    fallback={<Text class="settings-hint">None selected</Text>}
                                >
                                    {(actor) => (
                                        <>
                                            <ImageIcon url={actor().avatarUrl} size={26} />
                                            <Text class="truncate">{actor().name}</Text>
                                        </>
                                    )}
                                </Show>
                            </button>
                        </SettingsField>

                        <SettingsToggle
                            label="Debug mode"
                            hint="Adds a button in chats to inspect the exact prompt sent."
                            checked={state.userPreferences.debug ?? false}
                            onChange={(debug) => trpc.preferences.update.mutate({ debug })}
                        />
                    </SettingsGroup>
                </Section>

                <Section id="interface" label="Interface">
                    <SettingsGroup title="Chat">
                        <SettingsToggle
                            label="Auto-skip text"
                            hint="Narration and dialogue play straight through. Timed pauses still run."
                            checked={state.userPreferences.interface?.chat?.autoSkip ?? false}
                            onChange={setAutoSkip}
                        />
                    </SettingsGroup>
                </Section>

                <Section id="features" label="Features">
                    <SettingsGroup>
                        <For each={Object.values(FEATURES)}>
                            {(spec) => {
                                const cfg = () => resolveFeatureConfig(spec.key as FeatureKey, state.userPreferences.features?.[spec.key])
                                return (
                                    <div class="settings-feature">
                                        <SettingsToggle
                                            label={spec.name}
                                            hint={spec.description}
                                            checked={cfg().enabled}
                                            onChange={(enabled) => trpc.preferences.setFeature.mutate({ key: spec.key, enabled })}
                                        />
                                        <Show when={cfg().enabled}>
                                            <div class="settings-feature-body">
                                                <SchemaForm
                                                    fields={spec.schema}
                                                    values={cfg().values}
                                                    onChange={(values) => trpc.preferences.setFeature.mutate({ key: spec.key, values })}
                                                />
                                            </div>
                                        </Show>
                                    </div>
                                )
                            }}
                        </For>
                    </SettingsGroup>
                </Section>

                <Show when={!isStandalone()}>
                    <Section id="install" label="Install">
                        <SettingsGroup>
                            <button
                                type="button"
                                class="settings-inline-btn"
                                disabled={!installAvailable()}
                                onClick={() => { triggerInstall() }}
                            >
                                Install as app
                            </button>
                            <Show when={!installAvailable()}>
                                <Text size="sm" class="settings-hint">
                                    Needs HTTPS, and the browser takes a moment to qualify the site. On iOS: Safari's Share menu → Add to Home Screen.
                                </Text>
                            </Show>
                        </SettingsGroup>
                    </Section>
                </Show>
            </div>
        </div>
    )
}

/** Opens Preferences. The one entry point — nav rails, the home screen and the
 *  bottom bar all route here rather than to a tab. */
export function usePreferences() {
    const modal = useModal()
    return {
        open: () => modal.open({
            title: 'Preferences',
            fullscreen: true,
            content: () => <PreferencesDialog />,
        }),
    }
}
