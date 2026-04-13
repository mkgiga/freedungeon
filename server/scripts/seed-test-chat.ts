/**
 * Seeds a test chat with thousands of messages (varied block content) directly
 * into the sqlite DB — used to stress-test the chat virtualization.
 *
 * Run with:    bun run scripts/seed-test-chat.ts
 * Then restart the server so the new chat gets hydrated into state.
 *
 * Does NOT go through the db.ts module (which would trigger server startup via
 * the import chain); talks to sqlite directly with Bun's native driver.
 */
import { Database } from 'bun:sqlite'
import { nanoid } from 'nanoid'
import path from 'node:path'

const MESSAGE_COUNT = 10_000
const MIN_BLOCKS_PER_MESSAGE = 3
const MAX_BLOCKS_PER_MESSAGE = 18
const MESSAGE_INTERVAL_MS = 60_000 // 1 min between messages → 10k msgs ≈ 7 days of history

const DB_PATH = path.join(import.meta.dirname, '..', 'data', 'db', 'db.sqlite')

const db = new Database(DB_PATH)

// ── Grab real actor customIds if any exist, else fall back to fake ones.
//    (speech() blocks look up the actor by customId on the client.)
const actorRows = db.query(`SELECT customId FROM actors`).all() as { customId: string }[]
const ACTOR_IDS: string[] = actorRows.length > 0
    ? actorRows.map(r => r.customId)
    : ['test-a', 'test-b', 'test-c']

// ── Sample content pools (varied enough to make scroll-testing interesting)
const NARRATION = [
    'The corridor narrows as you step through the arch.',
    'A distant hum rises behind the walls, too rhythmic to be natural.',
    'Dust curls away from your boots in thin ribbons.',
    'The door swings shut with a definitive click.',
    'Light filters through the cracks overhead, pale and indifferent.',
    'Somewhere behind you, a floorboard groans.',
    'You cross the threshold and the air changes — colder, wetter.',
    'A single torch gutters in its sconce.',
    'The scent of iron hangs thick, unmissable.',
    'You count ten steps before the hallway turns.',
]

const DIALOGUE = [
    "I didn't think you'd come.",
    'We need to move. Now.',
    "That's not what I meant and you know it.",
    'Keep your voice down. They can hear us through the walls.',
    "I'm not afraid of them. I'm afraid of what we'll find.",
    "Hand me that, would you?",
    'You made a promise.',
    "There's no way out from here. Not anymore.",
    "Trust me — or don't. Either way, we leave tonight.",
    "That sound again. Do you hear it?",
]

const UNFORMATTED = [
    'test message content',
    'lorem ipsum dolor sit amet',
    'raw input from the user goes here',
    'short',
]

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!
}

function randInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1))
}

function randomBlock(): string {
    const r = Math.random()
    if (r < 0.45) {
        return `text(${JSON.stringify(pick(NARRATION))});`
    } else if (r < 0.88) {
        return `speech(${JSON.stringify(pick(ACTOR_IDS))}, ${JSON.stringify(pick(DIALOGUE))});`
    } else if (r < 0.96) {
        return `pause(${(Math.random() * 3).toFixed(1)});`
    } else {
        return `unformatted(${JSON.stringify(pick(UNFORMATTED))});`
    }
}

function randomMessage(): string {
    const count = randInt(MIN_BLOCKS_PER_MESSAGE, MAX_BLOCKS_PER_MESSAGE)
    return Array.from({ length: count }, randomBlock).join('\n')
}

// ── Insert the chat row.
const chatId = nanoid()
const now = Date.now()
const title = `Test Chat — ${MESSAGE_COUNT.toLocaleString()} messages`

db.query(`INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(chatId, title, now, now)

// ── Insert all messages in a single transaction (2-3 orders of magnitude
//    faster than 10k individual transactions on sqlite).
const insertMsg = db.query(
    `INSERT INTO chat_messages (id, chat_id, role, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
)

const baseTime = now - (MESSAGE_COUNT * MESSAGE_INTERVAL_MS)

console.log(`Seeding ${MESSAGE_COUNT.toLocaleString()} messages into chat ${chatId}…`)
const t0 = Date.now()

db.transaction(() => {
    for (let i = 0; i < MESSAGE_COUNT; i++) {
        const msgTime = baseTime + (i * MESSAGE_INTERVAL_MS)
        const role = i % 2 === 0 ? 'user' : 'assistant'
        insertMsg.run(nanoid(), chatId, role, randomMessage(), msgTime, msgTime)
    }
})()

const elapsed = Date.now() - t0
console.log(`\nDone in ${elapsed}ms.`)
console.log(`  Chat id:    ${chatId}`)
console.log(`  Title:      ${title}`)
console.log(`  Messages:   ${MESSAGE_COUNT.toLocaleString()}`)
console.log(`  Time range: ${new Date(baseTime).toISOString()} → ${new Date(baseTime + MESSAGE_COUNT * MESSAGE_INTERVAL_MS).toISOString()}`)
console.log(`\nRestart the server so it picks up the new chat from disk.`)

db.close()
