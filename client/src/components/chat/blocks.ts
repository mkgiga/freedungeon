// Block types, parser, and serializer live in shared/ so the same code runs
// on both the client (rendering) and the server (game-state replay). This file
// is a re-export shim so existing import paths under ./blocks continue to work.
export * from '@shared/blocks'
