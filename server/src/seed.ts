import { nanoid } from 'nanoid';
import type { Actor, Chat, Note } from '@shared/types';
import { mutate, state } from './server';
import { log } from './logger';

function makeSeed(now: number) {
    const scenarioId = nanoid();

    const actor = (
        customId: string,
        name: string,
        description: string,
        homeChatId: string | null,
    ): Actor => ({
        id: nanoid(),
        customId,
        name,
        description,
        avatarUrl: '',
        expressions: {},
        homeChatId,
        createdAt: now,
        updatedAt: now,
    });

    const note = (
        title: string,
        type: string,
        content: string,
        homeChatId: string | null,
        emoji?: string,
    ): Note => ({
        id: nanoid(),
        title,
        type,
        content,
        ...(emoji ? { emoji } : {}),
        homeChatId,
        createdAt: now,
        updatedAt: now,
    });

    const appearance = 'Appearance: (filled in by the agent)';

    const scenarioActors = [
        actor(
            'rhen',
            'Rhen',
            `${appearance}\n\n`
            + 'The one who found you face-down in a field and has not let you forget it. '
            + 'A working swordhand: competent, blunt, and completely unequipped to be '
            + 'complimented — praise produces a change of subject and, if pressed, an '
            + 'insult. Insists the arrangement is temporary. Has said so every day for '
            + 'weeks.',
            scenarioId,
        ),
        actor(
            'ash',
            'Ash',
            `${appearance}\n\n`
            + 'Absurdly powerful, and absolutely certain the two of you have met before '
            + 'in a life you have no memory of. Sits closer than the seating requires. '
            + 'Treats anyone else who holds your attention as a problem with a magical '
            + 'solution, and has to be talked out of it roughly once a week.',
            scenarioId,
        ),
        actor(
            'kestrel',
            'Kestrel',
            `${appearance}\n\n`
            + 'An elf ranger with a flat affect and a devastating sense of timing. Speaks '
            + 'in short declaratives, usually the most inconvenient true thing available. '
            + 'Registers no visible emotion, which makes the rare crack in it worth more '
            + 'than anything the others do loudly. Has appointed itself the party\'s scout '
            + 'and, without announcing it, your bodyguard.',
            scenarioId,
        ),
        actor(
            'pip',
            'Pip',
            `${appearance}\n\n`
            + 'The healer, and the reason the party keeps needing one. Cheerful, guileless, '
            + 'physically incapable of reading a room. Trips over flat ground, heals the '
            + 'enemy by accident, apologises at length, does it again. Genuinely the '
            + 'kindest person here, which is the only reason nobody has left them at an inn.',
            scenarioId,
        ),
    ];

    const scenarioNotes = [
        note("Isekai", "setting", `## Setting

This is a medieval low-fantasy Isekai setting. The agent is free to fill in background lore and any missing context at will. 

## Guidelines

- Events play out like a trashy seasonal Isekai. You have all the bog-standard Isekai tropes at your disposal, but don't overdo it.
- Actor {{ @Player.id }} will eventually (slowly) end up with a party of 4 actors of the opposite gender (unless stated otherwise in another note or actor's description), all who represent a different character trope. They are all attracted to {{ @Player.id }} for no believable reason whatsoever.`, null, '💭'),
    ];

    const scenario: Chat = {
        id: scenarioId,
        title: 'Scenario: Isekai',
        assets: { actors: [], notes: {}, images: [] },
        isTemplate: true,
        kind: 'roleplay',
        description: `This is an example Scenario. A scenario is a preset chat template that you can add Actors (your characters) and Notes (custom AI instructions).

You should try creating your own Scenario and creating any Actors and Notes you want!`,
        createdAt: now,
        updatedAt: now,
    };

    const libraryActors = [
        actor(
            'john_doe',
            'John Doe',
            `This is where John Doe's description would go, detailing his appearance, personality, etc. It can be formatted any way you want.`,
            null
        ),
        actor(
            'mary_sue',
            'Mary Sue',
            `This is where Mary Sue's description would go, detailing her appearance, personality, etc. It can be formatted any way you want.`,
            null
        ),
    ]

    const libraryNotes = [
        note("Example Note: Grounded Writing", "formatting", `Portray narrative and spoken content in a grounded, believable manner.`, null, '💭'),
    ];

    return { scenario, scenarioActors, scenarioNotes, libraryActors, libraryNotes };
}

function isEmptyLibrary(): boolean {
    return Object.keys(state.assets.chats).length === 0
        && Object.keys(state.assets.actors).length === 0
        && Object.keys(state.assets.notes).length === 0;
}

export function seedExampleContent(): void {
    if (!isEmptyLibrary()) return;

    const { scenario, scenarioActors, scenarioNotes, libraryActors, libraryNotes } =
        makeSeed(Date.now());

    mutate(s => { s.assets.chats[scenario.id] = scenario });

    for (const a of [...scenarioActors, ...libraryActors]) {
        mutate(s => { s.assets.actors[a.id] = a });
    }
    for (const n of [...scenarioNotes, ...libraryNotes]) {
        mutate(s => { s.assets.notes[n.id] = n });
    }

    mutate(s => {
        s.assets.chats[scenario.id]!.assets = {
            actors: scenarioActors.map(a => a.id),
            notes: Object.fromEntries(scenarioNotes.map(n => [n.id, { enabled: true }])),
            images: [],
        };
    });

    log.server.info(
        `Empty library: seeded "${scenario.title}" with `
        + `${scenarioActors.length + libraryActors.length} actors and `
        + `${scenarioNotes.length + libraryNotes.length} notes.`,
    );
}
