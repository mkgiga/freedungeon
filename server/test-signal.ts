// Minimal signal handler test for Bun on Windows
// Run with: bun run test-signal.ts
// Then press Ctrl+C

console.log('PID:', process.pid)
console.log('Platform:', process.platform)
console.log('Runtime:', typeof Bun !== 'undefined' ? 'Bun ' + Bun.version : 'Node')

// Test 1: Which events actually fire?
const events = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit', 'beforeExit']

for (const event of events) {
    process.on(event, (...args) => {
        console.log(`[FIRED] ${event}`, args)
    })
}

// Test 2: Does console.log work in handlers?
process.on('SIGINT', () => {
    console.log('[SIGINT handler] This should print')
    console.log('[SIGINT handler] Attempting sync file write...')

    // Test 3: Does sync file I/O work?
    try {
        const fs = require('fs')
        fs.writeFileSync('signal-test-output.txt', `SIGINT fired at ${Date.now()}`)
        console.log('[SIGINT handler] File written successfully')
    } catch (e) {
        console.log('[SIGINT handler] File write failed:', e)
    }

    process.exit(0)
})

// Keep alive
setInterval(() => {
    console.log('tick', Date.now())
}, 2000)

console.log('Ready. Press Ctrl+C...')
