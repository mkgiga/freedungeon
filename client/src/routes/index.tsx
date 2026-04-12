import { createFileRoute } from '@tanstack/solid-router'
import { TopBar } from '../components/TopBar'
import { Text } from '../components/typography/Text'

export const Route = createFileRoute('/')({ component: RouteComponent })

function RouteComponent() {
  return (
    <div class="flex flex-col h-full">
      <TopBar title="Home" />
      <div class="flex-1 overflow-y-auto flex items-center justify-center p-8">
        <Text size="sm" class="opacity-50">Nothing here yet.</Text>
      </div>
    </div>
  )
}
