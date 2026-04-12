import { createFileRoute } from '@tanstack/solid-router'
import { state } from '../state'
import { Heading } from '../components/typography/Heading'
import { Text } from '../components/typography/Text'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <div>
      <Heading level={1}>RPApp</Heading>
      <Text size="sm">State sync test: {state.currentChat?.title || 'waiting...'}</Text>
    </div>
  )
}
