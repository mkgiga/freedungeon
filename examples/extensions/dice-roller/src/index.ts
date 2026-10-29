import { roll } from './dice'
import type { FreedungeonHost } from './freedungeon'

export default {
    activate(fd: FreedungeonHost) {
        fd.settings.define([
            {
                path: ['sides'],
                label: 'Die',
                description: 'How many sides the button rolls.',
                default: 20,
                control: {
                    type: 'select',
                    options: [
                        { label: 'd6', value: 6 },
                        { label: 'd20', value: 20 },
                        { label: 'd100', value: 100 },
                    ],
                },
            },
            {
                path: ['tellTheDungeonMaster'],
                label: 'Tell the dungeon master',
                description: 'Rolls are mentioned to the narrator on the next turn.',
                default: true,
                control: { type: 'toggle' },
            },
        ])

        // Answers the button in the chat HUD. See content.ts.
        //
        // Held for as long as the roll takes, so the player can't send a
        // message into the gap. `hold` with a function releases in a `finally`,
        // so a throw here can't wedge the composer.
        fd.onCall('roll', () => fd.turn.hold('Rolling…', async () => {
            const sides = fd.settings.get('sides', 20)
            const value = roll(sides)

            fd.state.update((d) => {
                d.rolls = ((d.rolls as number) ?? 0) + 1
                d.last = value
                d.history = [...((d.history as number[]) ?? []), value].slice(-10)
            })

            fd.chat.post([{ type: 'text', text: `🎲 d${sides} → ${value}` }])

            if (fd.settings.get('tellTheDungeonMaster', true)) {
                fd.chat.systemNotice(`The player rolled a d${sides} and got ${value}.`)
            }

            return { sides, value, total: fd.state.values.rolls }
        }))

        // Rolls belong to the story they happened in, so a new one starts clean.
        fd.on('chat.loaded', () => fd.state.set('last', null))

        fd.log(`ready (${fd.state.values.rolls ?? 0} rolls so far)`)
    },

    deactivate() {
        // Optional. Runs after everything registered above is unwound.
    },
}
