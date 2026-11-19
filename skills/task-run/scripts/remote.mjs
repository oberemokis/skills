#!/usr/bin/env node
// Локальный вход в удалённый checkout: remote.mjs PROJECT [--task ID] -- COMMAND [ARG...]
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'
import { checkDocument } from './check-json.mjs'
import { normalizeRemote } from './resolve-project.mjs'

export function profile(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('нужно имя проекта')
  const dir = join(process.env.TASK_RUN_STATE ?? join(homedir(), '.local/state/task-run'), name)
  const data = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  const errors = checkDocument(data)
  if (errors.length || data.project !== name) throw new Error(`project.json: ${errors.join('; ') || 'имя не совпало'}`)
  return { dir, data }
}

const quote = value => `'${value.replaceAll("'", "'\\''")}'`
function ssh(host, command, capture = false) {
  const r = spawnSync('ssh', ['-T', '-a', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '--', host, command], {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8',
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw Object.assign(new Error(r.status === 255 || r.signal
    ? 'SSH: результат неизвестен; проверь удалённое состояние перед повтором'
    : `команда завершилась с кодом ${r.status}`), { status: r.status ?? 1 })
  return r.stdout
}

function target(p) {
  if (p.data.execution?.mode !== 'ssh') throw new Error('проект не настроен для SSH')
  return p.data.execution
}
function control(p, id) {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(id ?? '')) throw new Error('неверный ID задачи')
  return join(p.dir, 'control', id)
}

// Не публикуем сырой URL origin: он может содержать учётные данные.
export function inspect(p, cwd, expectedBranch) {
  const { host, root } = target(p)
  const raw = ssh(host, `cd ${quote(cwd)} && git rev-parse --show-toplevel --path-format=absolute --git-common-dir && git remote get-url origin && git rev-parse --abbrev-ref HEAD`, true)
  const [top, common, url, branch] = raw.trimEnd().split('\n')
  const origin = normalizeRemote(url ?? '')
  if (cwd !== top || common !== posix.join(root, '.git') || !p.data.remotes.map(normalizeRemote).includes(origin) ||
      !branch || (expectedBranch && branch !== expectedBranch)) {
    throw new Error('SSH: корень, origin или ветка не совпадают с проектом/задачей')
  }
  return { origin, branch }
}

export function bind(p, task, worktree, branch) {
  const { host, root } = target(p)
  const parent = posix.resolve(root, p.data.worktree.dir)
  if (!parent.startsWith(`${root}/`) || posix.dirname(worktree) !== parent || !branch) throw new Error('нужны worktree проекта и его ветка')
  inspect(p, worktree, branch)
  const dir = control(p, task)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, 'binding.json')
  const saved = { host, root, worktree, branch }
  try {
    writeFileSync(file, JSON.stringify(saved), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (readFileSync(file, 'utf8') !== JSON.stringify(saved)) throw new Error('цель задачи изменилась; проверь прежнюю привязку')
  }
  return dir
}

if (import.meta.main) {
  try {
    const [name, ...args] = process.argv.slice(2)
    const p = profile(name)
    const { host, root } = target(p)
    let cwd = root
    let branch
    if (args[0] === '--task') {
      args.shift()
      const saved = JSON.parse(readFileSync(join(control(p, args.shift()), 'binding.json'), 'utf8'))
      if (saved.host !== host || saved.root !== root) throw new Error('цель SSH изменилась; задача остановлена')
      cwd = saved.worktree
      branch = saved.branch
    }
    if (args.shift() !== '--' || !args.length) throw new Error('remote.mjs PROJECT [--task ID] -- COMMAND [ARG...]')
    inspect(p, cwd, branch)
    ssh(host, `cd ${quote(cwd)} && exec ${args.map(quote).join(' ')}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = error.status ?? 2
  }
}
