import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { DIR, FILE, GIT_LOCAL_ENV, checkHandoff, close, formatStatus, hookContext, prepare, readStatus } from './handoff.mjs'

const script = join(import.meta.dirname, 'handoff.mjs')

// pre-push хук запускает тесты с GIT_DIR клона. С ним `git -C <tmp> init` переинициализирует сам клон,
// а commit пишет в его индекс. Чистим окружение до первого вызова git, дочерние процессы его наследуют.
const hookEnv = Object.fromEntries(GIT_LOCAL_ENV.filter((key) => key in process.env).map((key) => [key, process.env[key]]))
for (const key of GIT_LOCAL_ENV) delete process.env[key]

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.org', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function commit(cwd, file, message) {
  writeFileSync(join(cwd, file), message)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
}

function repo() {
  // realpath: на macOS tmpdir лежит за ссылкой /var -> /private/var, а git отдаёт настоящий путь
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-')))
  git(dir, 'init', '-q', '-b', 'main')
  commit(dir, 'readme.md', 'начало')
  return dir
}

const handoffPath = (root) => join(root, DIR, FILE)

// заполняет каждый раздел, кроме снимка, как это сделал бы агент
function fill(root) {
  const text = readFileSync(handoffPath(root), 'utf8').replace(/^(## (?!Снимок).+)$/gm, '$1\n\nзаполнено')
  writeFileSync(handoffPath(root), text)
}

test('заготовка не видна git: рабочая копия остаётся чистой', () => {
  const root = repo()
  prepare(root, { agent: 'codex' })

  assert.ok(existsSync(handoffPath(root)))
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all'), '')
})

test('пустая заготовка не проходит проверку и называет каждый раздел', () => {
  const root = repo()
  prepare(root, { agent: '' })

  const problems = checkHandoff(readFileSync(handoffPath(root), 'utf8'))
  assert.ok(problems.some((p) => p.includes('agent')))
  for (const title of ['Задача', 'Следующий шаг', 'Тупики', 'Как проверить']) {
    assert.ok(problems.some((p) => p.includes(`«${title}»`)), title)
  }
})

test('заполненная передача проходит проверку', () => {
  const root = repo()
  prepare(root, { agent: 'claude-code' })
  fill(root)

  assert.deepEqual(checkHandoff(readFileSync(handoffPath(root), 'utf8')), [])
})

test('удалённый раздел и снятый фронтматтер называются', () => {
  const root = repo()
  prepare(root, { agent: 'opencode' })
  fill(root)
  const text = readFileSync(handoffPath(root), 'utf8')

  const withoutDeadEnds = text.replace(/## Тупики\n\nзаполнено\n/, '')
  assert.deepEqual(checkHandoff(withoutDeadEnds), ['нет раздела «Тупики»'])

  const withoutFront = text.replace(/^---\n[\s\S]*?\n---\n/, '')
  assert.ok(checkHandoff(withoutFront)[0].startsWith('нет фронтматтера'))
})

test('снимок фиксирует ветку, HEAD и незакоммиченные файлы', () => {
  const root = repo()
  writeFileSync(join(root, 'draft.ts'), 'черновик')
  prepare(root, { agent: 'codex' })

  const text = readFileSync(handoffPath(root), 'utf8')
  assert.match(text, /^branch: main$/m)
  assert.match(text, new RegExp(`^head: ${git(root, 'rev-parse', 'HEAD')}$`, 'm'))
  assert.match(text, /\?\? draft\.ts/)
})

test('новая передача уносит заполненную прежнюю в history, а пустую заготовку перезаписывает', () => {
  const root = repo()
  const history = join(root, DIR, 'history')

  prepare(root, { agent: 'codex', now: new Date('2026-11-16T10:00:00Z') })
  assert.equal(prepare(root, { agent: 'codex' }).archived, null)

  fill(root)
  const { archived } = prepare(root, { agent: 'claude-code', now: new Date('2026-11-16T12:00:00Z') })

  assert.ok(archived)
  assert.deepEqual(readdirSync(history), [archived.split('/').at(-1)])
  assert.match(readFileSync(archived, 'utf8'), /заполнено/)
})

test('принимающий видит коммиты, сделанные после передачи', () => {
  const root = repo()
  prepare(root, { agent: 'codex' })
  fill(root)
  commit(root, 'a.ts', 'после передачи')

  const status = readStatus(root)
  assert.equal(status.state, 'ready')
  assert.equal(status.drift.commits.length, 1)
  assert.match(formatStatus(status), /после передачи/)
})

test('переписанная история и смена ветки называются', () => {
  const root = repo()
  prepare(root, { agent: 'codex' })
  fill(root)
  git(root, 'commit', '-q', '--amend', '-m', 'переписан')
  git(root, 'switch', '-q', '-c', 'other')

  const status = readStatus(root)
  assert.ok(status.drift.rewritten)
  assert.ok(status.drift.branchChanged)
  assert.match(formatStatus(status), /История переписана/)
  assert.match(formatStatus(status), /была main, сейчас other/)
})

test('незаполненная передача отдаётся как оборванная, а не как готовая', () => {
  const root = repo()
  prepare(root, { agent: 'codex' })

  const status = readStatus(root)
  assert.equal(status.state, 'unfilled')
  assert.match(formatStatus(status), /оборвалась на записи/)
})

test('вне git передача пишется и читается без снимка', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-plain-')))
  prepare(dir, { agent: 'codex' })
  fill(dir)

  assert.match(readFileSync(handoffPath(dir), 'utf8'), /не в репозитории git/)
  assert.equal(readStatus(dir).state, 'ready')
})

test('close уносит передачу в history, после этого её нет', () => {
  const root = repo()
  prepare(root, { agent: 'codex' })
  fill(root)

  assert.ok(close(root))
  assert.equal(readStatus(root).state, 'missing')
  assert.equal(close(root), null)
})

test('хук молчит без передачи и называет её, когда она есть', () => {
  const root = repo()
  assert.equal(hookContext(root), null)

  prepare(root, { agent: 'codex' })
  fill(root)
  assert.match(hookContext(join(root)), /От: codex/)
})

test('хук через CLI: JSON события в stdin, контекст SessionStart в stdout', () => {
  const root = repo()
  const run = () => spawnSync(process.execPath, [script, 'hook'], { input: JSON.stringify({ cwd: root }), encoding: 'utf8' })

  const empty = run()
  assert.equal(empty.status, 0)
  assert.equal(empty.stdout, '')

  prepare(root, { agent: 'codex' })
  fill(root)
  const output = JSON.parse(run().stdout)
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(output.hookSpecificOutput.additionalContext, /скилл handoff/)
})

test('битый JSON в stdin хука не роняет старт сессии', () => {
  const result = spawnSync(process.execPath, [script, 'hook'], { input: '{ не json', encoding: 'utf8', cwd: tmpdir() })
  assert.equal(result.status, 0)
})

test('GIT_DIR чужого репозитория не уводит скрипт из папки передачи', () => {
  const root = repo()
  const other = repo()
  prepare(root, { agent: 'codex' })
  fill(root)
  commit(root, 'a.ts', 'после передачи')

  // так скрипт запускается из git-хука: окружение указывает на другой репозиторий
  const env = { ...process.env, ...hookEnv, GIT_DIR: join(other, '.git') }
  const result = spawnSync(process.execPath, [script, 'status', '--dir', root], { encoding: 'utf8', env })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /после передачи/)
  assert.equal(git(other, 'log', '--format=%s'), 'начало')
})

test('коды выхода CLI: нет передачи 3, не заполнена 1, заполнена 0', () => {
  const root = repo()
  const run = (command) => spawnSync(process.execPath, [script, command, '--dir', root], { encoding: 'utf8' }).status

  assert.equal(run('status'), 3)
  assert.equal(run('check'), 3)
  spawnSync(process.execPath, [script, 'prepare', '--dir', root, '--agent', 'codex'], { encoding: 'utf8' })
  assert.equal(run('check'), 1)
  assert.equal(run('status'), 1)
  fill(root)
  assert.equal(run('check'), 0)
  assert.equal(run('status'), 0)
})
