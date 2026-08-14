import { roll } from './dice'
import type { FreedungeonHost } from './freedungeon'

/**
 * The smallest extension that does something you can see.
 *
 * On activation it rolls a d20, keeps a running history in its own persisted
 * state, and raises a toast. Everything it touches is namespaced to its id, so
 * uninstalling it takes its data with it.
 */
export default {
    activate(fd: FreedungeonHost) {
        const value = roll(20)

        // Persisted and replicated to the client through the same funnel the
        // rest of the app uses. Assigning a new key just works — no setup.
        fd.state.update((d) => {
            d.rolls = ((d.rolls as number) ?? 0) + 1
            d.last = value
            d.history = [...(((d.history as number[]) ?? [])), value].slice(-10)
        })

        const total = fd.state.values.rolls
        fd.log(`rolled a ${value} (roll #${total})`)
        fd.notify({
            title: 'Dice Roller',
            message: `Rolled a ${value}. That is roll #${total} since installing.`,
        })
    },

    deactivate() {
        // Optional. Runs after the disposers above.
    },
}
