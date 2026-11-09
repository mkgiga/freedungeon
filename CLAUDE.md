# Supplemental Code Guidelines for Agents

1. Researching
    Don't rely on explore agents to handle tasks that require extensive research and planning. Explore agents tend to drop important context in their summaries; consider implementation mistakes more expensive than extra token spend.
2. Planning
    Weigh your options: When implementing a solution, should you roll a new system, or are there existing components that you can reuse? Prefer reusing existing systems when it makes sense, but do not be afraid to extend or refactor existing infrastructure should it not be sufficient for the task.
3. Comments
    Never add code comments. Your code is self-documenting.

---

# UI Design Guidelines

## Style Guidelines

These guidelines exist to help agents avoid common 'AI slop' design mistakes, and most importantly: making a clear, non-confusing

1. Clutter
    What's on the screen should only be what the user needs to see at any given time - ask yourself: 'Is this useful here? Does the user need to see this now?'
1. Nested Boxes Forbidden
    Any single element that renders its own visual threshold (e.g. a border, a background color) distinct from the background must NEVER have a descendant that does the same. This creates nested boxes and contributes clutter to the layout.
2. Establish typographic rules
    Use well-defined typographic rules across the whole UI.
3. Style reuse
    Always reuse styles such as CSS variables as to keep a consistent theme. Never hardcode/handroll styles inline.
4. Pressable elements
    Don't style all interactive elements like rectangular buttons - you can use clickable text labels too.
5. Layout reflow
    Elements with dynamic content must not push other inline elements in the layout context they share. - Consider these two examples:
      - A horizontal flexbox rail renders two elements: A label showing the current hour and minutes, and a label showing the name of the user's phone provider. The label showing the current time may change in width, which would move the other label left or right.
      - A shopping cart page that renders a list of items and checkout controls below the list: In order to prevent list items from moving the checkout controls, what do you do? You make a sticky rail inside the outer container that always renders at the bottom.
6. Use icons, never Emojis.
    Use real icons that (ideally) match the rest of the UI's design language such as an icon library, never Emojis.
7. Smart `display` choices
    Choose appropriate `display` types depending on the layout - Not everything should to be a flexbox.

## User-facing text content

**Any** text content that is displayed in a graphical user interface is considered **user-facing**. Here are the guidelines for such content:

1. NO NARRATION:
  - Do not narrate technical solutions that relate to the user's prompt or the feature that you are implementing.
  - Do not narrate internal machinery or how to use the application to the user of the interface. Use of the application is self-documenting through intuitive UX design using visual cues, feedback on actions, etc familiar UX design patterns.

---

# Project Overview

This is freedungeon, a roleplaying experience that leverages an LLM as the dungeon master. It is similar to projects like SillyTavern, but with a focus on user experience and multi-character scenarios.

## Concepts

- **Chat**: A conversation between the user an the LLM. The user prompts the AI via chat completions, and the AI responds with a special format that the frontend can parse to create a rich roleplaying experience.
- **Actor**: A reusable character card that can be imported into any chat.
- **Note**: A text string that gets injected into the chat completion system prompt at prompt time. This lets the user provide additional context to the LLM to steer its behavior.
- **LLM Config**: A set of parameters that govern the behavior of the LLM, such as temperature and max tokens. These are different depending on provider and model and the backend has a system for building UI forms for creating or editing LLM configs using JSON schema. See `client\src\components\json-ui\index.tsx` to learn more about our custom generative UI renderer.
- **Scenario**: A scenario is a blueprint of a chat which you can use to create new chats. Under the hood, a scenario is the same data model as regular chats (in the db), but marked with the field `isTemplate`, which is used to determine whether they should be rendered in the user's list of chats. <!-- **TODO:** It is currently a boolean value in the db - a nullable foreign key encodes more information so we should use that instead (chats that were created from a template get a `template` field (foreign key) and actual chat templates get to be null which is how we'd infer whether a chat is a template or not (as opposed to a simple boolean value) -->

## Architecture

### General Architecture

Both the backend and frontend are written in TypeScript and share a common codebase as well as shared types, which they import directly from the shared/ directory (which is not a package - they compile the shared code directly).

The frontend is built using Vite+SolidJS with SolidJS Tanstack Router.

The backend uses Bun and exposes a tRPC API.

### State Management

The backend holds a single global state object (`createStore` in `server.ts`) and emits updates to the frontend over socket.io. The client keeps an identical copy and renders from it. The client **never** modifies state directly — it sends tRPC requests, the server writes, and the change flows back down as a socket patch. One-way, always.

**Write state with `mutate`:**

```ts
mutate(s => { s.currentChat.gameState.itemDefs[key].icon = url })
```

`mutate` is Immer underneath. You mutate a draft; Immer reports exactly which leaves changed; each patch is applied to the store, handed to `persistPath`, and emitted to the client. Several edits in one call become several precise patches, not one coarse whole-object write. Because you're editing a draft, assigning a nested object creates it (`s.a.b = { c: 1 }` works whether or not `a.b` existed).

`setState`/`deleteState` still exist and are still correct, but are now reserved for two cases inside `server.ts`: paths whose segments are variables, and the boot writes — where `setStore`'s **merge** is load-bearing (`setState('userPreferences', loaded)` keeps keys the initial store declares that a stored file predates).

**The merge/replace rule.** A plain path write to a Solid store *merges* an object; it never removes keys. Replacing a record — renaming a key, dropping an entry — needs `produce` or `reconcile`, or the old key survives beside the new one. This has caused three separate bugs in this codebase; if a rename produces a duplicate, this is why.

**Arrays are leaf values.** Write them whole (`s.x.list = next`). Deleting an array index leaves a hole rather than splicing, and the patch protocol has no representation for splice or reorder. Anything that gains and loses members should be a `Record` keyed by id — which is what every `assets.*` root already is.

**Reactivity works on the server**, but only because we ask for it. solid's `exports` map sends the `node` condition to `dist/server.js`, a gutted SSR build where the store is inert and `createEffect` never runs. We override that: the `start`/`dev` scripts pass `--conditions browser` and `build.ts` passes `conditions: ['browser']`. Both have to agree, or the compiled binary gets the inert build and every effect silently stops firing. solid's reactive core needs no DOM — only `solid-js/web` does.

The cost of the real build is that the store is a lazy proxy, so a full walk is ~9x slower (2.5ms → 22ms serialising a 3000-message chat). That only lands on `socket.emit('init', …)`, once per client connection; per-write costs are unchanged. If it ever matters, emit `unwrap(state)` there.

`mutate` is still the way to write state, and is still explicit: an effect can observe a write now, but only `mutate` turns one into the patches `persistPath` and the socket need.

For application state types, see `shared/types.ts`.

### Data persistence

Data persistence is sqlite via kysely with a Bun adapter. The same choke point that emits socket patches also calls `persistPath`, which dehydrates the mutated entity to an SQL upsert (present in state) or delete (absent). The frontend and the database are updated through one path, so endpoints never write SQL themselves; when a new table is added, `persistPath` gains a branch. Non-persistable roots (`currentChat.gameState`, `isGenerating`, `notifications`, `activities`, `dependencies`, `extensions`, `extensionHolds`) simply fall through.

Deleting an *entity* also runs `applyDeleteCascades` (`cascade.ts`) before removal. The database's foreign keys act on a projection nothing reads back at runtime, so in-memory cascades are what actually keep the store consistent — evicting a Scenario's residents, removing its collaborator conversation, pruning refs to a deleted actor or note.

**Extension state vs. settings.** Two different roots, and the distinction matters:

- `state.extensionState[key]` is a persisted root backed by the `extension_state` table, for state the extension owns and writes. The host knows nothing about its shape, so `seedExtensionState` restores it verbatim at boot and an extension applies its own fallbacks on read. Written through `extensionStore(key)` in `extension-state.ts`, exposed to extensions as `fd.state`.
- `userPreferences.extensions[key]` is `{ enabled, values }` — user-authored settings, schema-rendered, rewritten wholesale. The schema comes from `fd.settings.define(fields)` at activation, and each field's `default` *is* the default, applied on read by `resolveExtensionConfig` so a field added later needs no migration.

For data models/types, see `server/src/db.ts`.

### LLM Provider Architecture

(todo documentation, refer to code for now)

### Project-specific Frontend Styling

- The frontend uses Tailwind CSS for styling.
- **Important**: Outer Flex menus/Flow containers/Item lists should never, ever provide spacing between its edge and its direct children. This is so that buttons can take up the full height and sit flush against the container's edges. No spacing should exist between buttons inside the flow containers - In contexts where square buttons exist mixed with other content (such as labels) where spacing is desirable between the labels and the buttons - you can group the buttons into a sub-container so that they don't get affected by any `gap` rule.
- Text is generally rendered using the dedicated Typography components within `client/src/components/typography/*`.