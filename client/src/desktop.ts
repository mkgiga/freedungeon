const tauri = (): { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } | undefined =>
    (globalThis as Record<string, any>).__TAURI_INTERNALS__

export const isDesktopApp = (): boolean => tauri()?.invoke !== undefined

/**
 * Close the desktop app. Only meaningful in the shell, so the menu entry is
 * hidden elsewhere rather than present and inert.
 *
 * Closing the window is the whole shutdown - the Destroyed handler takes the
 * backend and agent with it (main.rs `kill_tree`).
 */
export async function quitDesktopApp(): Promise<void> {
    await tauri()?.invoke?.('quit_app')
}
