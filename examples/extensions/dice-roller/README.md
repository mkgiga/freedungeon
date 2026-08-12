# Dice Roller — example extension

Rolls a d20 when it activates, keeps the last ten rolls in its own persisted
state, and raises a toast.

## What it demonstrates

- a `manifest.json` the host reads *without* executing anything
- TypeScript with no build step — the host transpiles it on import
- a relative import (`./dice`) across files
- persisted, replicated state via `fd.state`
- `fd.onDispose` for teardown that actually runs on disable and uninstall

## Installing

Copy this folder into your data directory:

    ~/.freedungeon/extensions/com.example.dice-roller/

Then open **Preferences → Extensions**, press **Rescan**, and switch it on.
A toast should appear immediately. Switching it off runs its disposers;
uninstalling removes the folder and drops its stored state.

## Structure

    manifest.json          identity; read at boot, never executed
    src/index.ts           entry point — default-exports { activate, deactivate }
    src/dice.ts            an ordinary relative import
    src/freedungeon.d.ts   authoring types (types only; the runtime object is injected)
