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

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# Project Overview

This is freedungeon, a roleplaying experience that leverages an LLM as the dungeon master. It is similar to projects like SillyTavern, but with a focus on user experience and multi-character scenarios.

## Concepts

- **Chat**: A conversation between the user an the LLM. The user prompts the AI via chat completions, and the AI responds with a special format that the frontend can parse to create a rich roleplaying experience.
- **Actor**: A reusable character card that can be imported into any chat.
- **Note**: A text string that gets injected into the chat completion system prompt at prompt time. This lets the user provide additional context to the LLM to steer its behavior.
- **LLM Config**: A set of parameters that govern the behavior of the LLM, such as temperature and max tokens. These are different depending on provider and model and the backend has a system for building UI forms for creating or editing LLM configs using JSON schema. See `client\src\components\json-ui\index.tsx` to learn more about our custom generative UI renderer.
- **Chat Template**: A chat template is a blueprint of a chat which you can use to create new chats. Under the hood, a chat template is the same db model as regular chats, but marked with the field `isTemplate`, which is used to determine whether they should be rendered in the user's list of chats. <!-- **TODO:** It is currently a boolean value in the db - a nullable foreign key encodes more information so we should use that instead (chats that were created from a template get a `template` field (foreign key) and actual chat templates get to be null which is how we'd infer whether a chat is a template or not (as opposed to a simple boolean value) -->

## Architecture

### General Architecture

Both the backend and frontend are written in TypeScript and share a common codebase as well as shared types, which they import directly from the shared/ directory (which is not a package - they compile the shared code directly).

The frontend is built using Vite+SolidJS with SolidJS Tanstack Router.

The backend uses Bun and exposes a tRPC API.

### State Management

The backend leverages solidjs' reactivity library to manage a single global state object using createStore, and emits updates to the frontend via socket.io events. The client contains a 100% identical copy of the global state object which is used to render the UI. The client never modifies its state directly, but instead emits tRPC calls to the backend, which then updates the global state and emits changes back to the frontend. This architecture allows for a very simple mental model of state management, and ensures that the frontend is always in sync with the backend.

All modifications to application state in the backend must be done via the `setState` or `deleteState` functions imported from `server.ts`, which ensure that the change is emitted to the frontend.

For application state types, see `shared/types.ts`.

### Data persistence

Data persistence is handled using sqlite with kysely as a query builder with a Bun adapter.

For data models/types, see `server/src/db.ts`.

### LLM Provider Architecture

(todo documentation, refer to code for now)

### Frontend Styling

The frontend uses Tailwind CSS for styling.

Text is rendered using dedicated Typography components inside `client\src\components\typography`.

(todo more documentation)