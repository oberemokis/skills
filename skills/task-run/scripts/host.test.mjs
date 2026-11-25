import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectHost } from './host.mjs'

const SERVER = '/opt/homebrew/bin/herdr server'
const SERVER_SPACE = '/Users/me/Applications/My Tools/herdr server'
const CLIENT = '/opt/homebrew/bin/herdr'

// Таблица процессов: [pid, ppid, команда]; от pid 100 вверх до 1.
function processes(rows) {
  const byPid = new Map(rows.map(([pid, ppid, command]) => [pid, { ppid, command }]))
  return (pid) => byPid.get(pid) ?? null
}

const cases = [
  ['панель herdr', [[100, 50, 'node host.mjs'], [50, 40, '-fish'], [40, 1, SERVER]], 'herdr'],
  ['путь сервера с пробелом', [[100, 50, 'node host.mjs'], [50, 40, '-zsh'], [40, 1, SERVER_SPACE]], 'herdr'],
  ['глубоко под агентом в панели', [[100, 60, 'node host.mjs'], [60, 50, 'claude'], [50, 40, '-fish'], [40, 1, SERVER]], 'herdr'],
  ['клиент herdr панелей не держит', [[100, 50, '-zsh'], [50, 40, CLIENT], [40, 1, '/usr/bin/login -fp me']], 'none'],
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
