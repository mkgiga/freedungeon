
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
    Don't style all interactive elements like rectangular buttons - you can use clickable text labels too; in this situation, don't change the background color on `:hover` because that would render a rectangular fill around the text.
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

# Project-specific styling constraints

The following guidelines are specific to this project:

- The frontend uses Tailwind CSS for styling.
- **Important**: Outer Flex menus/Flow containers/Item lists should never, ever provide spacing between its edge and its direct children. This is so that buttons can take up the full height and sit flush against the container's edges. No spacing should exist between buttons inside the flow containers - In contexts where square buttons exist mixed with other content (such as labels) where spacing is desirable between the labels and the buttons - you can group the buttons into a sub-container so that they don't get affected by any `gap` rule.
- Text is generally rendered using the dedicated Typography components within `client/src/components/typography/*`.