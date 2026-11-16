import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectHost } from './host.mjs'

const HC = '/Users/me/.local/share/herdr-core/active/Herdr Core/MacOS/herdr-core hold --socket /tmp/hc/default.sock'
const HC_DAEMON = '/Users/me/.local/share/herdr-core/active/Herdr Core/MacOS/herdr-core --hc-launchd'
const HERDR = '/opt/homebrew/bin/herdr server'

// Таблица процессов: [pid, ppid, команда]; от pid 100 вверх до 1.
function processes(rows) {
  const byPid = new Map(rows.map(([pid, ppid, command]) => [pid, { ppid, command }]))
  return (pid) => byPid.get(pid) ?? null
}

const cases = [
  ['терминал hc, путь держателя с пробелом', [[100, 50, 'node host.mjs'], [50, 40, '-zsh'], [40, 1, HC]], 'hc'],
  ['панель старого herdr', [[100, 50, 'node host.mjs'], [50, 40, '-zsh'], [40, 1, HERDR]], 'none'],
  ['старый herdr запущен в терминале hc: решает ближний', [[100, 50, '-zsh'], [50, 40, HERDR], [40, 30, '-zsh'], [30, 1, HC]], 'none'],
  ['ядро hc запущено из панели старого herdr: решает ближний', [[100, 50, '-zsh'], [50, 40, HC], [40, 30, '-zsh'], [30, 1, HERDR]], 'hc'],
  ['демон hc без hold держателем не считается', [[100, 50, '-zsh'], [50, 1, HC_DAEMON]], 'none'],
  ['обычный терминал', [[100, 50, 'node host.mjs'], [50, 40, '-zsh'], [40, 1, '/usr/bin/login -fp me']], 'none'],
]

for (const [name, rows, expected] of cases) {
  test(`хост определяется: ${name}`, () => {
    assert.equal(detectHost(100, processes(rows)), expected)
  })
}

test('ps не ответил: unknown, а не none', () => {
  assert.equal(detectHost(100, processes([[100, 50, '-zsh']])), 'unknown')
})

test('цикл в таблице процессов не зацикливает обход', () => {
  assert.equal(detectHost(100, processes([[100, 50, '-zsh'], [50, 100, '-zsh']])), 'none')
})
