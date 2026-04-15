# Project Overview

This is freedungeon, a roleplaying experience that leverages an LLM as the dungeon master. It is similar to projects like SillyTavern, but with a focus on user experience and multi-character scenarios.

# Concepts

- **Chat**: A conversation between the user an the LLM. The user prompts the AI via chat completions, and the AI responds with a special format that the frontend can parse to create a rich roleplaying experience.
- **Actor**: A reusable character card that can be imported into any chat.
- **Note**: A text string that gets injected into the chat completion system prompt at prompt time. This lets the user provide additional context to the LLM to steer its behavior.
- **LLM Config**: A set of parameters that govern the behavior of the LLM, such as temperature and max tokens. These are different depending on provider and model and the backend has a system for building UI forms for creating or editing LLM configs using JSON schema. See `client\src\components\json-ui\index.tsx` to learn more about our custom generative UI renderer.

# Architecture

## General Architecture

Both the backend and frontend are written in TypeScript and share a common codebase as well as shared types, which they import directly from the shared/ directory (which is not a package - they compile the shared code directly).

The frontend is built using Vite+SolidJS with SolidJS Tanstack Router.

The backend uses Bun and exposes a tRPC API.

## State Management

The backend leverages solidjs' reactivity library to manage a single global state object using createStore, and emits updates to the frontend via socket.io events. The client contains a 100% identical copy of the global state object which is used to render the UI. The client never modifies its state directly, but instead emits tRPC calls to the backend, which then updates the global state and emits changes back to the frontend. This architecture allows for a very simple mental model of state management, and ensures that the frontend is always in sync with the backend.

All modifications to application state in the backend must be done via the `setState` or `deleteState` functions imported from `server.ts`, which ensure that the change is emitted to the frontend.

For application state types, see `shared/types.ts`.

## Data persistence

Data persistence is handled using sqlite with kysely as a query builder with a Bun adapter.

For data models/types, see `server/src/db.ts`.

## LLM Provider Architecture

(todo documentation, refer to code for now)

## Frontend Styling

The frontend uses Tailwind CSS for styling.

Text is rendered using dedicated Typography components inside `client\src\components\typography`.

(todo more documentation)