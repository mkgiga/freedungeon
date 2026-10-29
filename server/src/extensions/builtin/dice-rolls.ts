import pkg from '../../../package.json' with { type: 'json' }
import type { ExtensionManifest } from '@shared/extensions'
import type { ExtensionModule } from '../sdk'

/**
 * Pulled fresh each turn through `prompt.section`, so the agent is never told
 * about a capability it doesn't have - the tool and the instructions are gated
 * by the same switch.
 */
export const DICE_ROLL_INSTRUCTIONS = `# 【Dice Rolls】

You can hand an outcome to chance with \`roll_random\`, which emits one observable event like \`text\` or \`speech\` does. Reach for it when an attempt is genuinely uncertain and you would otherwise be deciding the result yourself — and leave it alone when the outcome follows from what the scene has already established.

There are no character stats. You set each \`threshold\` from context: who is attempting this, with what, against what resistance. A roll has to come out strictly above its threshold, so the odds of success are 100 minus the number you pick — 25 for something they should manage, 50 for a genuine coin flip, 80 for a long shot.

One call carries as many independent rolls as the moment needs, each with its own actors and its own threshold, which is how you settle both sides of a contested moment at once. The results come back to you immediately and are binding: narrate from them, and never roll a second time for the same attempt.`

export const manifest: ExtensionManifest = {
    id: 'core.diceRolls',
    name: 'Dice rolls',
    version: pkg.version,
    description: 'The dungeon master can leave an uncertain attempt to a roll instead of deciding it.',
    author: 'freedungeon',
    main: '',
}

export const module: ExtensionModule = {
    activate(fd) {
        fd.prompt.section(() => DICE_ROLL_INSTRUCTIONS)
    },
}
