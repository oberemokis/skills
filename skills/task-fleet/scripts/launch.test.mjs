import assert from 'node:assert/strict'
import { test } from 'node:test'

import { asksTrust, liveSessions, options, runArgs } from './launch.mjs'

const UUID = '0b6f3c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f'
const DIRS = ['.worktrees']

// Терминал в форме `hc get --json`: только поля, которые читает подсчёт. Оболочка впереди с pid 100.
const terminal = ({ app = null, argv0 = '/bin/zsh', cwd = '/Users/me/project', labels = {} }) => ({
  labels,
  status: app ? { app, state: 'working' } : null,
  foreground: { argv: [argv0], cwd, pid: 100 },
})

// Claude дочерним процессом в группе оболочки, как под обёрткой launch.mjs (снято с живого запуска).
const WRAPPED = [{ pgid: 100, program: '/bin/zsh' }, { pgid: 100, program: 'claude' }]

test('место занимает сессия fleet на вопросе о доверии: статуса нет, Claude только в группе оболочки', () => {
  const t = terminal({ labels: { 'task-fleet': '1' } })
  assert.equal(liveSessions([t], DIRS, WRAPPED).length, 1)
  assert.equal(liveSessions([t], DIRS, [{ pgid: 100, program: '/bin/zsh' }, { pgid: 200, program: 'claude' }]).length, 0)
})

test('вопрос о доверии узнаётся по экрану Claude', () => {
  assert.ok(asksTrust(' Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder'))
  assert.ok(!asksTrust(' > Ответь одним словом: ок\n ⏺ ок'))
})

const cases = [
  ['сессия fleet под обёрткой: оболочка впереди, Claude в статусе', terminal({ app: 'claude-code', labels: { 'task-fleet': '1' } }), 1],
  ['Claude, запущенный руками в worktree', terminal({ argv0: 'claude', cwd: '/Users/me/project/.worktrees/feature-EYE-1' }), 1],
  ['Claude в основной папке проекта места не занимает', terminal({ app: 'claude-code', cwd: '/Users/me/project' }), 0],
  ['терминал fleet, из которого Claude вышел', terminal({ labels: { 'task-fleet': '1' } }), 0],
  ['оболочка в worktree без Claude', terminal({ cwd: '/Users/me/project/.worktrees/feature-EYE-1' }), 0],
  ['сама папка .worktrees ещё не worktree', terminal({ argv0: '/opt/bin/claude', cwd: '/Users/me/project/.worktrees' }), 0],
]

for (const [name, t, expected] of cases) {
  test(`место занимает: ${name}`, () => {
    assert.equal(liveSessions([t], DIRS, []).length, expected)
  })
}

test('промпт после -- уходит claude последним аргументом, после --session-id', () => {
  const opts = options(['--name', 'feature-eye-1', '--cwd', '/p/.worktrees/feature-EYE-1', '--task', 'EYE-1', '--session', UUID,
    '--', '/task-run EYE-1 --fleet --base dev'])
  const args = runArgs({ ...opts, ownSpace: 'main', parent: 't7', shell: '/bin/zsh' })
  assert.deepEqual(args.slice(args.indexOf('--')), [
    '--', '/bin/zsh', '-lc', 'claude "$@"; exec "$SHELL" -l', 'claude', '--session-id', UUID, '/task-run EYE-1 --fleet --base dev',
  ])
})

test('--resume поднимает ту же сессию вместо новой', () => {
  const opts = options(['--name', 'n', '--cwd', '/p', '--task', 'EYE-1', '--session', UUID, '--resume', '--', 'продолжай'])
  const args = runArgs({ ...opts, ownSpace: null, parent: 't7', shell: '/bin/zsh' })
  assert.deepEqual(args.slice(-3), ['--resume', UUID, 'продолжай'])
  assert.ok(!args.includes('--session-id'))
})

test('флаги claude после -- не съедаются разбором скрипта', () => {
  const opts = options(['--name', 'read-x', '--cwd', '/p', '--task', 'read-x', '--session', UUID,
    '--', '--permission-mode', 'plan', '--disallowedTools=Edit,Write', 'что тут происходит'])
  assert.deepEqual(opts.claudeArgs, ['--permission-mode', 'plan', '--disallowedTools=Edit,Write', 'что тут происходит'])
})

test('метки задачи, сессии и пространства; без своего пространства метки дерева нет', () => {
  const opts = options(['--name', 'feature-eye-1', '--cwd', '/p', '--task', 'EYE-1', '--session', UUID])
  const labels = (args) => args.flatMap((a, i) => (args[i - 1] === '--label' ? [a] : []))
  assert.deepEqual(labels(runArgs({ ...opts, ownSpace: null, parent: 't7', shell: '/bin/zsh' })), [
    'task-fleet=1', 'task=EYE-1', `claude-session=${UUID}`,
    'herdr.space=fleet-feature-eye-1', 'herdr.tab=fleet-feature-eye-1-tab', 'task-fleet.parent=t7',
  ])
  assert.ok(labels(runArgs({ ...opts, ownSpace: 'main', parent: 't7', shell: '/bin/zsh' })).includes('task-fleet.space=main'))
})

test('без --session скрипт сам выдаёт новый UUID, а --resume без него отклоняется', () => {
  const base = ['--name', 'n', '--cwd', '/p', '--task', 'EYE-1']
  const first = options(base).session
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(options(base).session, first)
  assert.throws(() => options([...base, '--resume']), /--resume/)
})

test('плохие аргументы отклоняются до запуска', () => {
  const base = ['--cwd', '/p', '--task', 'EYE-1', '--session', UUID]
  assert.throws(() => options(['--name', 'Feature/EYE-1', ...base]), /--name/)
  assert.throws(() => options(['--name', 'n', '--cwd', 'relative', '--task', 'EYE-1', '--session', UUID]), /--cwd/)
  assert.throws(() => options(['--name', 'n', '--cwd', '/p', '--task', 'EYE-1', '--session', UUID.toUpperCase()]), /--session/)
  assert.throws(() => options(['--name', 'n', ...base, '--limit', '0']), /--limit/)
})
