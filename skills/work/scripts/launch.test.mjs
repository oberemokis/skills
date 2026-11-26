import assert from 'node:assert/strict'
import { test } from 'node:test'

import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentProcess, arrangeTabs, asksTrust, liveSessions, openArgs, options, repoRoot, startArgs, stopAgent, tokens } from './launch.mjs'

const UUID = '0b6f3c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f'
const DIRS = ['.worktrees']

// Панель в форме `herdr api snapshot`: только поля, которые читает подсчёт.
const pane = ({ agent = null, cwd = '/Users/me/project', tokens = {} }) => ({
  pane_id: 'w1:p1',
  ...(agent ? { agent, agent_status: 'idle' } : { agent_status: 'unknown' }),
  foreground_cwd: cwd,
  tokens,
})

const proc = (pid, ppid, args, stat = 'S+') => ({ pid, ppid, stat, argv0: args.split(' ')[0], args })

const cases = [
  ['сессия work, в том числе на вопросе о доверии и после Ctrl+Z', pane({ agent: 'claude', tokens: { work: '1' } }), 1],
  ['Claude, запущенный руками в worktree', pane({ agent: 'claude', cwd: '/Users/me/project/.worktrees/feature-PROJ-1' }), 1],
  ['Claude в основной папке проекта места не занимает', pane({ agent: 'claude' }), 0],
  ['панель work, из которой агент вышел', pane({ tokens: { work: '1' } }), 0],
  ['оболочка в worktree без агента', pane({ cwd: '/Users/me/project/.worktrees/feature-PROJ-1' }), 0],
  ['сама папка .worktrees ещё не worktree', pane({ agent: 'claude', cwd: '/Users/me/project/.worktrees' }), 0],
]

for (const [name, p, expected] of cases) {
  test(`место занимает: ${name}`, () => {
    assert.equal(liveSessions([p], DIRS).length, expected)
  })
}

test('агент ищется от оболочки панели вглубь, остановленный по Ctrl+Z виден остановленным', () => {
  const procs = [proc(100, 1, '-fish'), proc(101, 100, 'claude --resume x', 'T')]
  assert.deepEqual(agentProcess(100, procs), { pid: 101, kind: 'claude', stopped: true })
  const deep = [proc(100, 1, '-fish'), proc(110, 100, '/bin/sh -c x'), proc(111, 110, '/opt/bin/claude')]
  assert.equal(agentProcess(100, deep)?.pid, 111)
})

test('фоновый сервер агента агентом не считается, сам OpenCode под ним считается', () => {
  assert.equal(agentProcess(100, [proc(100, 1, '-fish'), proc(101, 100, 'claude mcp serve')]), null)
  const oc = [proc(100, 1, '-fish'), proc(101, 100, 'opencode --standalone'), proc(102, 101, '/x/opencode serve --stdio --port 0')]
  assert.deepEqual(agentProcess(100, oc), { pid: 101, kind: 'opencode', stopped: false })
})

test('вопрос о доверии узнаётся по экрану Claude', () => {
  assert.ok(asksTrust(' Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder'))
  assert.ok(!asksTrust(' > Ответь одним словом: ок\n ⏺ ок'))
})

const BASE = ['--name', 'feature-proj-1', '--cwd', '/p/.worktrees/feature-PROJ-1', '--task', 'PROJ-1']
const start = (argv) => startArgs(options(argv), 'w9:p1', 60000)
const tail = (args) => args.slice(args.indexOf('--') + 1)

test('агент стартует под именем ветки в панели задачи с таймаутом готовности', () => {
  assert.deepEqual(start([...BASE, '--session', UUID]).slice(0, 9),
    ['agent', 'start', 'feature-proj-1', '--kind', 'claude', '--pane', 'w9:p1', '--timeout', '60000'])
})

test('OpenCode открывает оценщик в локальной TUI и продолжает по тому же ID', () => {
  const args = start([...BASE, '--agent', 'opencode', '--estimate-first', '--task-args', 'PROJ-1 --work'])
  const session = args[args.indexOf('--session') + 1]
  assert.match(session, /^ses_/)
  assert.deepEqual(tail(args), ['--standalone', '--session', session, '--prompt', '@task-estimate PROJ-1 --work'])
  assert.deepEqual(tail(start([...BASE, '--agent', 'opencode', '--resume', '--session', session, '--', 'продолжай'])),
    ['--standalone', '--session', session, '--prompt', 'продолжай'])
})

test('промпт task-run собирает скрипт из --task-args и ставит последним, после --session-id', () => {
  assert.deepEqual(tail(start([...BASE, '--session', UUID, '--task-args', 'PROJ-1 --work --base dev'])),
    ['--session-id', UUID, '/task-run PROJ-1 --work --base dev'])
})

test('задача без оценки открывает оценщик в той же панели с аргументами задачи', () => {
  assert.equal(start([...BASE, '--estimate-first', '--task-args', 'PROJ-1 --work --level L']).at(-1), '/task-estimate PROJ-1 --work --level L')
})

test('--resume поднимает ту же сессию вместо новой', () => {
  const args = start(['--name', 'n', '--cwd', '/p', '--task', 'PROJ-1', '--session', UUID, '--resume', '--', 'продолжай'])
  assert.deepEqual(tail(args), ['--resume', UUID, 'продолжай'])
})

test('аргументы агента после -- не съедаются разбором скрипта и идут до промпта', () => {
  const opts = options(['--name', 'read-x', '--cwd', '/p', '--task', 'read-x', '--session', UUID,
    '--', '--permission-mode', 'plan', '--disallowedTools=Edit,Write', 'что тут происходит'])
  assert.deepEqual(opts.agentArgs, ['--permission-mode', 'plan', '--disallowedTools=Edit,Write', 'что тут происходит'])
  assert.deepEqual(startArgs(opts, 'w9:p1', 1000).slice(-4), opts.agentArgs)
})

test('метки панели: work, задача, агент и сессия', () => {
  assert.deepEqual(tokens(options([...BASE, '--session', UUID])), ['work=1', 'task=PROJ-1', 'agent=claude', `agent-session=${UUID}`])
})

test('без --session скрипт сам выдаёт новый UUID, --resume без сессии отклоняется', () => {
  const first = options(BASE)
  assert.match(first.session, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(options(BASE).session, first.session)
  assert.throws(() => options([...BASE, '--resume']), /--resume/)
})

test('плохие аргументы отклоняются до запуска', () => {
  const base = ['--cwd', '/p', '--task', 'PROJ-1', '--session', UUID]
  assert.throws(() => options(['--name', 'Feature/PROJ-1', ...base]), /--name/)
  // Имя агента в herdr начинается с буквы.
  assert.throws(() => options(['--name', '42-fix', ...base]), /--name/)
  assert.throws(() => options(['--name', 'n', '--cwd', 'relative', '--task', 'PROJ-1', '--session', UUID]), /--cwd/)
  assert.throws(() => options(['--name', 'n', '--cwd', '/p', '--task', 'PROJ-1', '--session', UUID.toUpperCase()]), /--session/)
  assert.throws(() => options(['--name', 'n', ...base, '--limit', '0']), /--limit/)
  assert.throws(() => options(['--name', 'n', ...base, '--budget', '0']), /--budget/)
  assert.throws(() => options(['--name', 'n', ...base, '--agent', 'cursor']), /--agent/)
  assert.throws(() => options(['--name', 'n', ...base, '--task-args', ' ']), /--task-args/)
})

test('корень репозитория есть только у связанного worktree', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'work-repo-')))
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', '-b', 'feature/x', '.worktrees/feature-x')
    assert.equal(repoRoot(join(dir, '.worktrees/feature-x')), dir)
    assert.equal(repoRoot(dir), null)
    assert.equal(repoRoot(tmpdir()), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('worktree открывается группой под пространством репозитория', () => {
  const wt = '/r/.worktrees/feature-x'
  const repo = { workspace_id: 'w1', worktree: { repo_root: '/r', is_linked_worktree: false, checkout_path: '/r' } }
  const plainRepo = { workspace_id: 'w2' }
  const other = { workspace_id: 'w3', worktree: { repo_root: '/o', is_linked_worktree: false, checkout_path: '/o' } }
  const tail = ['--path', wt, '--label', 'work-x', '--no-focus']
  const cases = [
    ['пространство репозитория из herdr', [other, repo], [], ['worktree', 'open', '--workspace', 'w1', ...tail]],
    ['обычное пространство в корне репозитория', [plainRepo], [{ workspace_id: 'w2', cwd: '/r' }], ['worktree', 'open', '--workspace', 'w2', ...tail]],
    ['пространства репозитория нет, herdr заводит его сам', [other], [], ['worktree', 'open', '--cwd', '/r', ...tail]],
  ]
  for (const [name, workspaces, panes, want] of cases) {
    assert.deepEqual(openArgs(wt, '/r', workspaces, panes, 'work-x'), want, name)
  }
  const plain = ['workspace', 'create', '--cwd', wt, '--label', 'work-x', '--no-focus']
  assert.deepEqual(openArgs(wt, null, [repo], [], 'work-x'), plain, 'не worktree')
  const open = { workspace_id: 'w4', worktree: { repo_root: '/r', is_linked_worktree: true, checkout_path: wt } }
  assert.deepEqual(openArgs(wt, '/r', [repo, open], [], 'work-x'), plain, 'worktree уже открыт в чужом пространстве')
})

test('новое пространство: первая вкладка agent, вторая diff с gitone от точки отсчёта', () => {
  const created = { workspace: { workspace_id: 'w5' }, root_pane: { pane_id: 'w5:p1', tab_id: 'w5:t1' } }
  const calls = []
  const call = (args) => {
    calls.push(args)
    return args[1] === 'create' ? { root_pane: { pane_id: 'w5:p2' } } : null
  }
  assert.equal(arrangeTabs(created, '/r/.worktrees/x', 'abc123', call), true)
  assert.deepEqual(calls, [
    ['tab', 'rename', 'w5:t1', 'agent'],
    ['tab', 'create', '--workspace', 'w5', '--cwd', '/r/.worktrees/x', '--label', 'diff', '--no-focus'],
    ['pane', 'run', 'w5:p2', 'gitone abc123'],
  ])
  calls.length = 0
  arrangeTabs(created, '/r/.worktrees/x', null, call)
  assert.deepEqual(calls.at(-1), ['pane', 'run', 'w5:p2', 'gitone'], 'без базы только незакоммиченное')
  // Сбой вкладок запуск не роняет.
  assert.equal(arrangeTabs(created, '/x', 'abc', () => { throw new Error('herdr') }), false)
})

test('--base принимает имя ветки и отклоняет мусор', () => {
  assert.equal(options([...BASE, '--base', 'feature/PROJ-0']).base, 'feature/PROJ-0')
  assert.equal(options(BASE).base, null)
  assert.throws(() => options([...BASE, '--base', 'a b']), /--base/)
})

test('агент гасится TERM и затем CONT, уже вышедший процесс не ошибка', () => {
  const sent = []
  stopAgent({ pid: 101 }, (pid, signal) => sent.push([pid, signal]))
  assert.deepEqual(sent, [[101, 'SIGTERM'], [101, 'SIGCONT']])
  const gone = Object.assign(new Error('no such process'), { code: 'ESRCH' })
  assert.doesNotThrow(() => stopAgent({ pid: 101 }, () => { throw gone }))
  assert.throws(() => stopAgent({ pid: 1 }, () => { throw Object.assign(new Error('nope'), { code: 'EPERM' }) }), /nope/)
})
