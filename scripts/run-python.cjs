const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const candidates = []
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  const launcher = join(
    process.env.LOCALAPPDATA,
    'Programs',
    'Python',
    'Launcher',
    'py.exe',
  )
  if (existsSync(launcher)) candidates.push([launcher, ['-3.12']])
}
candidates.push(['python3.12', []], ['python3', []], ['python', []])

for (const [command, prefix] of candidates) {
  const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: false,
  })
  if (!result.error) process.exit(result.status ?? 1)
  if (result.error.code !== 'ENOENT') throw result.error
}

console.error('Python 3.12 or newer was not found.')
process.exit(1)
