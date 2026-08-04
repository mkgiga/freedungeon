/**
 * `{ type: 'file' }` imports resolve to a path string at runtime. The declaration
 * lets entry.ts typecheck without dist/assets.blob existing — it's a build
 * artifact, so it isn't there on a clean checkout.
 */
declare module '*.blob' {
    const path: string
    export default path
}
