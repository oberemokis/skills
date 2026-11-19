#!/usr/bin/env node
// Находит папку проекта task-run по адресу origin репозитория, из основной папки или из любого worktree.
// Вывод JSON: status found | missing | broken, код выхода 0 | 3 | 4; 2, если это не репозиторий с origin.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function normalizeRemote(url) {
  let value = url.trim()

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  // логин и токен из https-адреса в вывод попасть не должны
  value = value.replace(/^[^@/]+@/, '')

  const scp = value.match(/^([^:/]+):(?!\d+\/)(.+)$/)
  if (scp) value = `${scp[1]}/${scp[2]}`

  value = value.replace(/^([^/:]+):\d+\//, '$1/')
  value = value.replace(/\.git\/?$/, '').replace(/\/+$/, '')

  return value.toLowerCase()
}

export function findProject(origin, stateDir) {
  const wanted = normalizeRemote(origin)
  const broken = []

  if (!existsSync(stateDir)) return { match: null, broken }

  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const file = join(stateDir, entry.name, 'project.json')
    if (!existsSync(file)) continue

    let project
    try {
      project = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // битый файл может быть как раз нашим проектом: о нём надо сказать, а не пропустить молча
      broken.push(file)
      continue
    }

    const remotes = Array.isArray(project.remotes) ? project.remotes.map(normalizeRemote) : []
    if (remotes.includes(wanted)) return { match: { project: entry.name, dir: join(stateDir, entry.name) }, broken }
  }

  return { match: null, broken }
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

async function main() {
  const named = process.argv[2] === '--project'
  const cwd = (!named && process.argv[2]) || process.cwd()
  const stateDir = process.env.TASK_RUN_STATE ?? join(homedir(), '.local/state/task-run')
  const { profile, inspect } = await import('./remote.mjs')
  const emit = (name, local) => {
    const p = profile(name)
    const execution = p.data.execution ?? { mode: 'local' }
    const base = execution.mode === 'ssh'
      ? { root: execution.root, origin: inspect(p, execution.root).origin }
      : local
    if (!base || !p.data.remotes.map(normalizeRemote).includes(base.origin)) throw new Error('для локального профиля нужен его checkout')
    console.log(JSON.stringify({ status: 'found', project: name, dir: p.dir, stateDir, ...base, execution }))
  }
  if (named) {
    const name = process.argv[3]
    if (!name) throw new Error('--project: нужно имя профиля')
    let p
    try { p = profile(name) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      console.log(JSON.stringify({ status: 'missing', project: name, stateDir }))
      process.exitCode = 3
      return
    }
    if (p.data.execution?.mode === 'ssh') return emit(name)
  }

  let origin
  let commonDir
  try {
    origin = git(cwd, ['remote', 'get-url', 'origin'])
    commonDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  } catch {
    console.log(JSON.stringify({ status: 'no-origin', cwd }))
    process.exit(2)
  }

  // корень проекта один для основной папки и всех worktree: родитель общего .git
  const root = dirname(commonDir)
  const { match, broken } = findProject(origin, stateDir)
  const base = { origin: normalizeRemote(origin), root, stateDir }
  if (named) return emit(process.argv[3], base)

  if (match) {
    return emit(match.project, base)
  }

  const status = broken.length > 0 ? 'broken' : 'missing'
  console.log(JSON.stringify({ status, broken, ...base }))
  process.exit(status === 'broken' ? 4 : 3)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = error.status ?? 4 })
