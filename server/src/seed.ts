import { nanoid } from 'nanoid';
import type { Actor, Chat, Note } from '@shared/types';
import { mutate, state } from './server';
import { log } from './logger';

/**
 * Example content written once, into a database that has never held any.
 *
 * A first launch otherwise lands on empty lists everywhere — the app can't show
 * what a Scenario is for, that notes steer the narrator, or that a character is
 * a reusable card, because there is nothing to look at. Seeding gives every
 * screen something real, and gives the user something to take apart rather than
 * a blank page to design from.
 *
 * Deliberately not tied to onboarding. That stamp answers "has this person been
 * shown the setup flow", which is a different question from "does this database
 * have anything in it" — restoring a backup, pointing --data-dir somewhere new,
 * or wiping the file all produce an empty library on an install that was
 * onboarded long ago.
 *
 * The content lives here as literals rather than in a JSON or Markdown asset
 * because a compiled binary has no source tree to read from; anything on disk
 * would need the same embedding treatment the prompt files get (see embedded.ts).
 */

/** Everything below shares one timestamp — they were authored together. */
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

    // ── The example Scenario and its residents ────────────────────────────
    //
    // The four the note promises, one trope each.
    //
    // Appearance is left to the agent on purpose, and doubles as a demonstration
    // of the shape of a card: what you write is what the narrator is bound by,
    // so anything you leave open it will invent to fit the scene. It also keeps
    // the note's "opposite gender to {{ @Player.id }}" rule working — describing
    // them here would quietly override it for half of all players.
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

    // ── Library content, usable in any chat ───────────────────────────────
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

/**
 * True only for a database that has never held content.
 *
 * Actors and notes are soft-deleted — the rows survive as tombstones so old
 * messages keep resolving portraits — so a user who clears their library still
 * reads as non-empty here and is not re-seeded. Chats are the exception: they
 * delete outright, which is why emptiness is tested across all three rather
 * than any one of them.
 */
function isEmptyLibrary(): boolean {
    return Object.keys(state.assets.chats).length === 0
        && Object.keys(state.assets.actors).length === 0
        && Object.keys(state.assets.notes).length === 0;
}

export function seedExampleContent(): void {
    if (!isEmptyLibrary()) return;

    const { scenario, scenarioActors, scenarioNotes, libraryActors, libraryNotes } =
        makeSeed(Date.now());

    // Order is forced by the foreign keys, which point both ways: an actor's
    // home_chat_id references chats, and chat_actor_refs references actors. So
    // the Scenario row goes in first with no attachments, then its residents
    // can name it as home, and only then is it given its refs. Writing the
    // fully-populated chat up front would fail on rows that don't exist yet.
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
