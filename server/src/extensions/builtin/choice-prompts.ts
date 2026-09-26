import pkg from '../../../package.json' with { type: 'json' }
import type { ExtensionManifest } from '@shared/extensions'
import type { ExtensionModule } from '../sdk'

/**
 * Pulled fresh each turn through `prompt.section`, so the agent is never told
 * about a capability it doesn't have - the tool and the instructions are gated
 * by the same switch.
 */
export const MULTICHOICE_PROMPT_INSTRUCTIONS = `# 【Choice Prompts】

When you call \`end_turn\`, you may pass a \`choices\` array — an enumerated set of 2+ candidate next actions salient to the focus actor at this branch point. Enumerate them only when the branch genuinely narrows to a few distinct, material actions; otherwise leave the next move open, as usual. The focus actor's controller may select one — it returns next tick as \`choice("...")\` rather than \`unformatted("...")\` — or disregard the set entirely and supply any other action. A selection is the focus actor's action; treat it exactly as the equivalent \`unformatted(...)\` input. Never assume the controller is bound to the enumerated set.`

export const manifest: ExtensionManifest = {
    id: 'core.choicePrompts',
    name: 'Multiple-choice prompts',
    version: pkg.version,
    description: 'The dungeon master can end a turn with suggested actions. You can still type your own.',
    author: 'freedungeon',
    main: '',
}

export const module: ExtensionModule = {
    activate(fd) {
        fd.prompt.section(() => MULTICHOICE_PROMPT_INSTRUCTIONS)
    },
}
