#!/usr/bin/env node
// Находит папку проекта task-run по адресу origin репозитория, из основной папки или из любого worktree.
// Вывод JSON: status found | missing | broken, код выхода 0 | 3 | 4; 2, если это не репозиторий с origin.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function main() {
  const cwd = process.argv[2] ?? process.cwd()
  const stateDir = process.env.TASK_RUN_STATE ?? join(homedir(), '.local/state/task-run')

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

  if (match) {
    console.log(JSON.stringify({ status: 'found', ...match, ...base }))
    return
  }

  const status = broken.length > 0 ? 'broken' : 'missing'
  console.log(JSON.stringify({ status, broken, ...base }))
  process.exit(status === 'broken' ? 4 : 3)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
