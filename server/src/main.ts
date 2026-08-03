/**
 * Launch entry for both `bun src/main.ts` and the compiled binary.
 *
 * Everything here happens before the application loads: arguments are parsed,
 * applied to the environment, and only then is the server (or the bundled
 * agent) imported. The imports below are deliberately dynamic — a static
 * `import './server'` would be hoisted above this code and would read the
 * environment before the flags reached it.
 */

import { parseLaunchOptions, applyLaunchOptions, USAGE } from './cli'
import pkg from '../package.json' with { type: 'json' }

let opts
try {
    opts = parseLaunchOptions()
} catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(`\n${USAGE}`)
    process.exit(2)
}

if (opts.help) {
    console.log(USAGE)
    process.exit(0)
}

if (opts.version) {
    console.log(pkg.version)
    process.exit(0)
}

applyLaunchOptions(opts)

if (opts.agent) {
    // The compiled binary re-execs itself with --agent rather than spawning a
    // second runtime; in dev the agent is spawned directly with its own cwd, so
    // this branch is only reached from that re-exec.
    await import('../../integrations/agent-claude/index.ts')
} else {
    await import('./server')
}
