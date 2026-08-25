const tauri = (): { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } | undefined =>
    (globalThis as Record<string, any>).__TAURI_INTERNALS__

export const isDesktopApp = (): boolean => tauri()?.invoke !== undefined

/**
 * Close the desktop app.
 *
 * Only meaningful in the shell — a browser tab cannot close itself unless a
 * script opened it, which is why the menu entry that calls this is hidden
 * outside the desktop build rather than present and inert.
 *
 * Closing the window is the whole shutdown: the shell's Destroyed handler takes
 * the backend and the agent down with it (see main.rs `kill_tree`), so there is
 * nothing else to stop first.
 */
export async function quitDesktopApp(): Promise<void> {
    await tauri()?.invoke?.('quit_app')
}
