# Macros

Macros are magic words that transform into something else when the AI looks at them. It is useful when you want a [character description](actors.md#description) or [note](notes.md) to reference the player character's name, which can change often. This is handy because it lets you avoid having to change a lot of texts every time you want to play a different character.

## Syntax

(TODO proper syntax guide)

## Examples

- Player actor's name
    ```
    {{ player.name }} never loses and everybody loves them.
    ```
- Player actor's first name and last name
    ```
    First name: {{ player.firstName }}
    Last name: {{ player.lastName }}
    ```
- Player actor's ID
    ```
    Instruction for the AI:
    {{ player.id }} is mute and cannot talk.
    ```

(TODO better examples)