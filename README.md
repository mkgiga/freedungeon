# Overview

Freedungeon is a roleplaying frontend where AI is the dungeon master. It is inspired by projects like [Sillytavern](https://github.com/SillyTavern/SillyTavern) and [oobabooga/textgen](https://github.com/oobabooga/textgen).

## Project Goals

- User Experience goals:
    * Must be easy and comfortable to use for most people.
    * Mobile & Desktop UI
    * No information overload. It doesn't have to be an airplane dashboard.
- Support Models:
    * [x] Local AI Models (Ollama, LMStudio, llama.cpp, etc.)
    * [x] Claude
    * [ ] Google Gemini
    * [x] ChatGPT
    * [x] Deepseek v4
- Interactive game state:
    * [x] Character state
        - Actors have their own health, and take damage if the AI calls the `damage(id, value)` tool.
    * [x] Show nearby characters
        - AI can manage nearby actors/objects, which shows up in the UI.
    * [x] Player inventory
        - AI can give you custom items, which you can drag and drop to use on nearby actors.

## Table of Contents
- [Overview](overview.md)
- [Install](docs/install.md)
- [Configuration](docs/configuration.md)
- Concepts
  * [Actors](docs/actors.md)
  * [Notes](docs/notes.md)
  * [Chats](docs/chats.md)
  * [Macros](docs/macros.md)
- [Contributing](#for-contributors)
  * [Guidelines](#guidelines)
- [License](#license)

## For Contributors

(TODO this section)

## License

<blockquote>
Copyright 2026 mkgiga

Permission is hereby granted, free of charge, to any person obtaining a copy of this software > and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
</blockquote>
