import { state } from '../../state'
import { useModal } from '../Modal'
import { Text } from '../typography/Text'
import { Em } from '../typography/Em'

/**
 * Guard for anything that triggers an agent turn.
 *
 * A chat with no live SDK session has to have its whole history injected before
 * the agent can respond, which costs real tokens — so the first such action
 * asks first. Shared rather than local to the composer because a choice menu is
 * now answered from the message history, and that is just as much a turn
 * trigger as pressing send.
 */
export function useRehydrationConfirm() {
    const modal = useModal()

    /**
     * Runs `run`, first confirming if this chat would need rehydrating.
     * Resolves true when the action ran, false when the user cancelled.
     */
    return (actionLabel: string, run: () => Promise<void> | void): Promise<boolean> => {
        const rehydration = state.currentChat.agentRehydration
        if (!rehydration) {
            const r = run()
            return Promise.resolve(r instanceof Promise ? r.then(() => true) : true) as Promise<boolean>
        }
        return new Promise<boolean>((resolve) => {
            modal.open({
                title: 'Rebuild agent memory?',
                content: () => (
                    <div>
                        <Text>
                            This chat has <Em bold>{rehydration.messageCount} prior messages</Em>{' '}
                            but no live agent session. The next agent turn will inject the full
                            chat history into a new session so the agent regains context.
                        </Text>
                        <Text class="mt-2">
                            <Em type="warning" bold>One-time cost:</Em> approximately{' '}
                            <Em bold>{rehydration.estimatedTokens.toLocaleString()} input tokens</Em>{' '}
                            (rough char/4 estimate). Subsequent prompts in this chat resume the
                            rebuilt session normally and hit cache.
                        </Text>
                        <div class="modal-confirm-actions">
                            <button class="modal-btn modal-btn-cancel" onClick={() => { modal.close(); resolve(false) }}>Cancel</button>
                            <button
                                class="modal-btn modal-btn-confirm"
                                onClick={async () => {
                                    modal.close()
                                    await run()
                                    resolve(true)
                                }}
                            >
                                {actionLabel}
                            </button>
                        </div>
                    </div>
                ),
            })
        })
    }
}
