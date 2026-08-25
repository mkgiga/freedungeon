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
import { KeybindEditor } from './KeybindEditor'
import { ExtensionsList } from './ExtensionsList'
import { viewport } from '../viewport'
import { FEATURES, resolveFeatureConfig, type FeatureKey } from '@shared/features'
import { useImageGenConsent } from './ImageGenConsent'
import { installAvailable, isStandalone, triggerInstall } from '../pwa-install'
import { ShowOn } from './ShowOn'

type SectionId = 'general' | 'interface' | 'keybinds' | 'features' | 'extensions' | 'install'

export function PreferencesDialog() {
    const pickers = useAssetPickers()
    const configs = useLlmConfigs()
    const confirmImageGen = useImageGenConsent()

    const setFeatureEnabled = async (key: FeatureKey, enabled: boolean) => {
        if (key === 'imageGen' && enabled && !(await confirmImageGen())) return
        await trpc.preferences.setFeature.mutate({ key, enabled })
    }

    const sections = (): { id: SectionId; label: string }[] => [
        { id: 'general', label: 'General' },
        { id: 'interface', label: 'Interface' },
        ...(viewport() === 'phone' ? [] : [{ id: 'keybinds' as const, label: 'Keybinds' }]),
        { id: 'features', label: 'Features' },
        { id: 'extensions', label: 'Extensions' },
        ...(isStandalone() ? [] : [{ id: 'install' as const, label: 'Install' }]),
    ]

    let scroller: HTMLDivElement | undefined
    const anchors = new Map<SectionId, HTMLElement>()
    const [current, setCurrent] = createSignal<SectionId>('general')

    const OFFSET = 24
    const syncCurrent = () => {
        if (!scroller) return
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
                            hint="Adds a button in chats to see exactly what was sent to the model."
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

                <Show when={viewport() !== 'phone'}>
                    <Section id="keybinds" label="Keybinds">
                        <SettingsGroup>
                            <Text size="sm" class="settings-hint">
                                Click a shortcut, then press the keys you want. Escape cancels.
                            </Text>
                            <KeybindEditor />
                        </SettingsGroup>
                    </Section>
                </Show>

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
                                            onChange={(enabled) => setFeatureEnabled(spec.key as FeatureKey, enabled)}
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

                <Section id="extensions" label="Extensions">
                    <SettingsGroup>
                        <ExtensionsList />
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
