const tauri = (): { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } | undefined =>
    (globalThis as Record<string, any>).__TAURI_INTERNALS__

export const isDesktopApp = (): boolean => tauri()?.invoke !== undefined

/**
 * Closing the window is the whole shutdown - the Destroyed handler takes the
 * backend and agent with it (main.rs `kill_tree`). No-op outside the shell.
 */
export async function quitDesktopApp(): Promise<void> {
    await tauri()?.invoke?.('quit_app')
}
