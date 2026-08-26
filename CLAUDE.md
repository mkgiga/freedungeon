# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Code as the source of truth

Do not rely on Explore Agents to find and summarize parts of the code. Explore Agents tend to drop important context during the summarization process. Instead, prefer exploring repositories on your own; The cost of an inaccurate architectural assumption outweighs any tokens that (would have) been saved from use of agentic exploration tools.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---


# UI Design Guidelines

These design guidelines aim to deter default AI agent 'slop' visuals and improve user experience in general.

## Brief definition of 'Aesthetic' (noun)

'An aesthetic' or a 'style' is an emergent symptom created by pattern-seeking behaviors of the human mind. Establishing arbitrary constraints on elements' visual attributes is mandatory for a pleasant experience; Typograhic rules for text content, container line & column gaps, a constrained palette, etc...

## Layout guidelines

1. Forbidden: Stacked Cards
    A bordered container may not have a child at any depth that also renders its own borders. This is by far the biggest sin of modern LLMs - we avoid this at all costs. A card can only render on top of the page background color, never inside another card.
2. Icons
    Use an icon library, never Emojis. Some icon libraries will harmonize better with the rest of the interface. Take this simplified example: Pick the round icons for the UI that uses rounded borders, and square/boxy icons for those without rounded borders. Apply this to all visual attributes and you get the idea.
3. Style reuse
    Never hardcode magic values. Define CSS variables that you can reuse to prevent drift when things change.
4. Pressable elements
    Don't style all interactive elements like rectangular buttons - you can use clickable text labels too.
5. Smart `display` choices
    Choose appropriate `display` types depending on the layout - Not everything should to be a flexbox.

## User-facing text content guidelines

1. User-facing text
    - BREVITY: Verbosity is hell, brevity is heaven. User attention span isn't cheap, and that's why you should cut all padding.
    - RELEVANCE:
        1. Does the text content you are about to add need to exist at all? If the UI already shows how to do something - Don't narrate it! Second-guess yourself every time.
        2. If it does: Explanatory text content must serve a *visitor of the app*  - NOT the developer that prompted you! Leaking context related to your prompt into the UI is a sin punishable by 20 hours in the torture tower.
    - LANGUAGE: Cut technical details or explainers about internal logic that only serve to confuse visitors. Example Scenario: You are designing a settings menu where every field is succeeded by a tooltip label. You decide to add a new field, and you make its tooltip label something that *briefly states what it is* - **not** system documentation.

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

**There is no reactivity on the server.** Bun resolves solid-js's SSR build, where the store is inert: `createEffect` never runs, not even once. Reactivity is a client-only thing here, and `mutate` is explicit precisely because nothing can observe a write on its own. Do not add an effect to `server/src` expecting it to fire — it will fail silently.

For application state types, see `shared/types.ts`.

### Data persistence

Data persistence is sqlite via kysely with a Bun adapter. The same choke point that emits socket patches also calls `persistPath`, which dehydrates the mutated entity to an SQL upsert (present in state) or delete (absent). The frontend and the database are updated through one path, so endpoints never write SQL themselves; when a new table is added, `persistPath` gains a branch. Non-persistable roots (`currentChat.gameState`, `isGenerating`, `notifications`, `activities`, `dependencies`) simply fall through.

Deleting an *entity* also runs `applyDeleteCascades` (`cascade.ts`) before removal. The database's foreign keys act on a projection nothing reads back at runtime, so in-memory cascades are what actually keep the store consistent — evicting a Scenario's residents, removing its collaborator conversation, pruning refs to a deleted actor or note.

**Extension state.** `state.extensionState[key]` is a persisted root backed by the `extension_state` table, for state an extension owns. It is *not* `userPreferences.features[key].values`, which is settings: user-authored, schema-rendered, rewritten wholesale. Extensions declare defaults via `FeatureSpec.state` and write through `extensionStore(key)` in `extension-state.ts`.

For data models/types, see `server/src/db.ts`.

### LLM Provider Architecture

(todo documentation, refer to code for now)

### Frontend Styling

- The frontend uses Tailwind CSS for styling.
- **Important**: Outer Flex menus/Flow containers/Item lists should never, ever provide spacing between its edge and its direct children. This is so that buttons can take up the full height and sit flush against the container's edges. No spacing should exist between buttons inside the flow containers - In contexts where square buttons exist mixed with other content (such as labels) where spacing is desirable between the labels and the buttons - you can group the buttons into a sub-container so that they don't get affected by any `gap` rule.
- Text is generally rendered using the dedicated Typography components within `client/src/components/typography/*`.