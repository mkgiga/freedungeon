
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
    await import('../../integrations/agent-claude/index.ts')
} else {
    await import('./server')
}
