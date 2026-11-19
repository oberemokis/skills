import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('./remote.mjs', import.meta.url))

test('шлюз находит профиль без клона, передаёт stdin и argv в рабочую копию; потеря ответа не повторяет запись', t => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'fleet-ssh-')))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  const root = join(tmp, "remote's repo")
  const dir = join(tmp, 'app')
  mkdirSync(dir)
  const git = (...args) => assert.equal(spawnSync('git', args).status, 0)
  git('init', '-q', root)
  git('-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-qm', 'base')
  git('-C', root, 'remote', 'add', 'origin', 'git@host.org:team/app.git')
  const project = {
    schema: 'task-run/project@1', project: 'app', remotes: ['host.org/team/app'], execution: { mode: 'ssh', host: 'dev-wsl', root },
    taskId: 'PROJ-\\d+', branch: 'feature/{id}', base: 'main', commit: '{summary}',
    tracker: { kind: 'test', check: 'test' }, codeHost: { kind: 'test', host: 'host.org', check: 'test' },
    worktree: { dir: '.worktrees', exclude: [], install: [], localFiles: [] }, checks: {},
  }
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project))
  // Подменена только сеть: запускаем переданную OpenSSH строку настоящей оболочкой.
  writeFileSync(join(tmp, 'ssh'), '#!/bin/sh\nwhile [ "$#" -gt 1 ]; do shift; done\nsh -c "$1"\ns=$?\ncase "$1" in *"&& exec "*) exit "${DROP:-$s}";; esac\nexit "$s"\n')
  chmodSync(join(tmp, 'ssh'), 0o755)
  const run = (args, input, env) => spawnSync(process.execPath, [cli, 'app', '--', ...args], {
    cwd: dir, encoding: 'utf8', input, env: { ...process.env, TASK_RUN_STATE: tmp, PATH: `${tmp}:${process.env.PATH}`, ...env },
  })
  const path = "x ' $(pwd)"
  const args = ['sh', '-c', 'cat >> "$1"', 'write', path]
  const first = run(args, 'first\n')
  assert.equal(first.status, 0, first.stderr)
  assert.equal(run(args, 'last\n', { DROP: '255' }).status, 255)
  assert.equal(readFileSync(join(root, path), 'utf8'), 'first\nlast\n')
  assert.throws(() => readFileSync(join(dir, path)), { code: 'ENOENT' })

  const tree = join(root, '.worktrees', 'feature-PROJ-1')
  git('-C', root, 'worktree', 'add', '-qb', 'feature/PROJ-1', tree)
  const invoke = (url, argv, env = {}) => spawnSync(process.execPath, [fileURLToPath(new URL(url, import.meta.url)), ...argv], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, HC_TERMINAL_ID: '', TASK_RUN_STATE: tmp, PATH: `${tmp}:${process.env.PATH}`, ...env },
  })
  const result = invoke('./resolve-project.mjs', ['--project', 'app'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).root, root)
  const launch = invoke('../../task-fleet/scripts/launch.mjs', ['--project', 'app', '--cwd', tree, '--branch', 'feature/PROJ-1',
    '--task', 'PROJ-1', '--task-args', 'PROJ-1 --fleet', '--name', 'feature-proj-1'])
  assert.match(launch.stderr, /HC_TERMINAL_ID/)
  const bound = ['app', '--task', 'PROJ-1', '--']
  const inTree = invoke('./remote.mjs', [...bound, 'pwd', '-P'])
  assert.equal(inTree.stdout.trim(), tree, inTree.stderr)
  const command = (...args) => invoke('./remote.mjs', [...bound, ...args])
  assert.equal(command('sh', '-c', 'echo "import assert from \'node:assert/strict\'; assert.equal(2 + 2, 4)" > smoke.test.mjs').status, 0)
  const check = command(process.execPath, '--test', 'smoke.test.mjs')
  assert.equal(check.status, 0, check.stderr)
  assert.equal(command('git', 'add', '-N', 'smoke.test.mjs').status, 0)
  assert.match(command('git', 'diff', 'HEAD').stdout, /\+import assert/)
  assert.throws(() => readFileSync(join(root, 'smoke.test.mjs')), { code: 'ENOENT' })
  git('-C', tree, 'switch', '-qc', 'different')
  const wrong = invoke('./remote.mjs', [...bound, 'touch', 'wrong'])
  assert.notEqual(wrong.status, 0)
  assert.throws(() => readFileSync(join(tree, 'wrong')), { code: 'ENOENT' })
})
