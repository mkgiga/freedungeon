# Extensions

Everything optional is an extension, including the features that ship with the
app. Open **Preferences → Extensions** to switch one on or off and to configure
it. An extension that is off is not running: none of its code has been
executed.

The ones named `core.*` are built in. They cannot be uninstalled, but they are
otherwise ordinary extensions and behave exactly like the ones you add.

| | |
|---|---|
| `core.choicePrompts` | The dungeon master can end a turn with suggested actions. You can still type your own. |
| `core.imageGeneration` | Draws item icons and scene pictures on this machine. Downloads about 3 GB the first time. |

## Installing

Drop a `.zip` on the Extensions panel, or put a folder in
`~/.freedungeon/extensions/` and press **Rescan**. Uninstalling removes the
folder and everything the extension stored.

---

## Writing one

An extension is a folder with a `manifest.json` and some TypeScript. There is
no build step — the app transpiles it on the way in.

```json
{
  "id": "com.you.thing",
  "name": "Thing",
  "version": "1.0.0",
  "main": "src/index.ts",
  "content": "src/content.ts"
}
```

`main` runs on the server. `content` is optional and runs in the browser. The
`core.` prefix is reserved.

A working example that uses every surface below lives in
`examples/extensions/dice-roller`, including a `freedungeon.d.ts` you can copy
next to your source for autocomplete.

### The server half

```ts
export default {
    activate(fd) { /* … */ },
    deactivate() { /* optional */ },
}
```

Register everything from inside `activate`. Every registration hands back the
call that undoes it, and all of them are unwound when the extension is switched
off — so `deactivate` is for things the host doesn't know about.

`fd` is the app's own machinery, not a copy of it. What you write with it
persists, replicates to every open tab, and replays on reload exactly like the
app's own writes.

| | |
|---|---|
| `fd.state` | Your own persisted bag: `.values`, `.set`, `.remove`, `.update`. |
| `fd.app.state` / `fd.app.update(draft => …)` | The whole application state, and the one way to change it. |
| `fd.chat` | `.post(blocks)`, `.systemNotice(text)`, `.prompt(text)`, plus the loaded chat's `id` and `messages`. |
| `fd.game.exec(command, args)` | Change game state by running a command, the way the dungeon master's own tools do. |
| `fd.blocks` | `.parse` / `.serialize`. A message is serialized blocks, nothing else. |
| `fd.activity.run(kind, data, fn)` | Show in-flight work the way the app shows its own. |
| `fd.settings` | `.define(fields)` draws a form in Preferences; `.get(name)` reads it. |
| `fd.prompt.section(fn)` | Contribute to the system prompt. Pulled fresh each turn; return `null` to sit one out. |
| `fd.prompt.scope(name, fn)` | Answer a `{{ name }}` [macro](macros.md) in prompt templates. |
| `fd.on(event, handler)` | A lifecycle hook. |
| `fd.onCall(name, handler)` | Answer your browser half. |
| `fd.notify`, `fd.log`, `fd.warn`, `fd.error` | Say something. |

Throwing out of `activate` refuses the switch: the extension stays off and the
reason is shown to the user. That is how to decline to run when something you
need isn't there.

`fd.settings.define` takes fields whose `default` **is** the default, so a
setting you add later arrives with one on installs that never stored it. A
handler registered with `fd.settings.onChange` runs *before* the change is
written, and throwing refuses it.

### Hooks

`app.ready`, `app.shutdown`, `chat.created`, `chat.loaded`, `message.created`,
`message.updated`, `message.deleted`, `turn.start`, `turn.end`,
`command.executed`.

Hooks are observers. The app does not wait on one and does not read what it
returns, so a slow or throwing handler costs its own extension and nothing
else. To contribute *to* a turn, use `fd.prompt.section` instead.

### The browser half

```ts
export default {
    activate(fd) {
        fd.ui.slot('chat.hud', (el) => {
            const button = document.createElement('button')
            button.onclick = () => fd.call('roll')
            el.append(button)
            return () => button.remove()
        })
    },
}
```

You get a plain element and plain DOM — no framework. Return a teardown and it
runs when the slot goes away.

Slots: `app.leftNav`, `app.overlay`, `chat.hud`, `chat.sidebar`, and
`settings.extension` (your own block in Preferences).

`fd.call(name, args)` reaches your server half's `fd.onCall`. `fd.state` is the
live application state, read-only — the browser never writes state; it asks the
server, and the change comes back down. `fd.watch(read, react)` re-runs `react`
whenever `read` returns something new.
