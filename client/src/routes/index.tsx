import { createFileRoute } from '@tanstack/solid-router'
import { createResource, For, Show } from 'solid-js'
import { MdFillChevron_right } from 'solid-icons/md'
import { TopBar } from '../components/TopBar'
import { Text } from '../components/typography/Text'
import { Heading } from '../components/typography/Heading'
import { Loader } from '../components/Loader'
import { setActiveTab, type Tab } from '../tab-state'
import { trpc } from '../trpc'

export const Route = createFileRoute('/')({ component: RouteComponent })

type DashboardLink = { label: string; target: Tab }

const ASSET_LINKS: DashboardLink[] = [
  { label: 'Actors', target: 'actors' },
  { label: 'Notes', target: 'notes' },
]

const SETTINGS_LINKS: DashboardLink[] = [
  { label: 'Preferences', target: 'preferences' },
]

function DashboardList(props: { links: DashboardLink[] }) {
  return (
    <div class="flex flex-col rounded-lg border border-[color-mix(in_oklch,var(--text),transparent_85%)] overflow-hidden">
      <For each={props.links}>
        {(link, i) => (
          <button
            type="button"
            class="flex items-center justify-between px-4 py-3 text-left hover:bg-[color-mix(in_oklch,var(--text),transparent_92%)]"
            classList={{ 'border-t border-[color-mix(in_oklch,var(--text),transparent_90%)]': i() > 0 }}
            onClick={() => setActiveTab(link.target)}
          >
            <span>{link.label}</span>
            <MdFillChevron_right size={20} class="opacity-40" />
          </button>
        )}
      </For>
    </div>
  )
}

function RouteComponent() {
  const [news] = createResource(() => trpc.news.list.query())

  return (
    <div class="flex flex-col h-full">
      <TopBar
        title="Home"
        slots={{
          right: (
            <Text size="sm" font="mono" class="opacity-50 pr-4">v{__APP_VERSION__}</Text>
          ),
        }}
      />
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        <section class="flex flex-col gap-3 pl-4 font-serif">
          <Show
            when={news()}
            fallback={
              <div class="flex items-center gap-3 opacity-50">
                <Loader size={20} />
                <Text size="sm">Loading news…</Text>
              </div>
            }
          >
            <For each={news()}>
              {(item) => (
                <article class="flex flex-col gap-2 max-h-[50dvh] overflow-y-auto">
                  <header class="flex flex-col gap-1">
                    <Heading level={1}>{item.title}</Heading>
                    <Text size="sm" class="opacity-50 italic">
                      {new Date(item.timestamp).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </Text>
                  </header>
                  <For each={item.content}>
                    {(paragraph) => (
                      <Text size="sm" class="opacity-80">
                        <span innerHTML={paragraph} />
                      </Text>
                    )}
                  </For>
                </article>
              )}
            </For>
          </Show>
        </section>

        <section class="flex flex-col gap-2">
          <Heading level={2}>Assets</Heading>
          <DashboardList links={ASSET_LINKS} />
        </section>

        <section class="flex flex-col gap-2">
          <Heading level={2}>Settings</Heading>
          <DashboardList links={SETTINGS_LINKS} />
        </section>
      </div>
    </div>
  )
}
