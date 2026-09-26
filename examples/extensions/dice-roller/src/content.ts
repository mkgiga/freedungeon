import type { FreedungeonClient } from './freedungeon'

/**
 * Runs in the browser. It gets a plain element and plain DOM - no framework,
 * no build step, no bundling: relative imports name the real file and the
 * server transpiles TypeScript on the way out.
 */
export default {
    activate(fd: FreedungeonClient) {
        fd.ui.slot('chat.hud', (el) => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'chat-inventory-slot'
            button.textContent = '🎲'

            const sync = () => {
                const sides = fd.settings.get('sides', 20)
                button.title = `Roll a d${sides}`
                button.disabled = fd.state.isGenerating
            }

            button.addEventListener('click', async () => {
                button.disabled = true
                try { await fd.call('roll') } finally { sync() }
            })

            sync()
            fd.watch(() => fd.state.isGenerating, sync)
            el.append(button)

            return () => button.remove()
        })
    },
}
