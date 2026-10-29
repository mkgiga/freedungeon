# Dice Roller — example extension

Puts a die button in the chat HUD. Clicking it rolls, posts the result into the
story, tells the dungeon master about it, and keeps the last ten rolls in its
own persisted state.

## What it demonstrates

- a `manifest.json` the host reads *without* executing anything
- TypeScript with no build step, on both sides — the host transpiles on import
- a relative import (`./dice`) across files
- a settings form declared with `fd.settings.define`, rendered by the app
- persisted, replicated state via `fd.state`
- writing to the story with `fd.chat.post` and `fd.chat.systemNotice`
- a lifecycle hook (`fd.on('chat.loaded', …)`)
- holding the next turn while it works (`fd.turn.hold`)
- browser UI in a layout slot (`fd.ui.slot('chat.hud', …)`)
- the browser half calling the server half (`fd.call` ↔ `fd.onCall`)

## Installing

Copy this folder into your data directory:

    ~/.freedungeon/extensions/com.example.dice-roller/

Then open **Preferences → Extensions**, press **Rescan**, and switch it on.
Switching it off unwinds everything it registered, on both sides; uninstalling
removes the folder and drops its stored state.

## Structure

    manifest.json          identity; read at boot, never executed
    src/index.ts           server entry — default-exports { activate, deactivate }
    src/content.ts         browser entry — draws into slots, calls the server half
    src/dice.ts            an ordinary relative import
    src/freedungeon.d.ts   authoring types (types only; the runtime object is injected)
