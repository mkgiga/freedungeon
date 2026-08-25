import { roll } from './dice'
import type { FreedungeonHost } from './freedungeon'

export default {
    activate(fd: FreedungeonHost) {
        const value = roll(20)

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
