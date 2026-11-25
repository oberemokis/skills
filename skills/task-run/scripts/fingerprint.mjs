#!/usr/bin/env node
// Отпечаток диффа задачи: всё, чем рабочая копия отличается от точки отсчёта задачи, вместе с новыми
// файлами и их содержимым. Один и тот же для одобренного показа (`reviewedDiff`) и результатов
// тестовых случаев: правка любого файла задачи меняет отпечаток, и прежний pass перестаёт считаться.
// Коммит отпечаток не меняет: дифф считается от точки отсчёта, а не от HEAD.
//
// Точка отсчёта это merge-base HEAD с базой. Баз две: `origin/<база>` и локальная `<база>`, берётся
// более новая. Локальная нужна задаче на стопке поверх ветки, которой нет в origin: от origin в дифф
// попали бы коммиты нижней задачи.
//
//   fingerprint.mjs <база> [<worktree>]           отпечаток
//   fingerprint.mjs --point <база> [<worktree>]   точка отсчёта, SHA коммита
//
// Вывод одной строкой. Код выхода 2: ошибка вызова; 1: git ответил ошибкой или базы нет.
// Скрипт самодостаточен: для удалённого проекта его исполняют через stdin, импорты соседей не дойдут.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const run = (cwd) => (args) =>
  execFileSync('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], {
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const attempt = (git, args) => {
  try {
    return git(args).toString().trim()
  } catch {
    return null
  }
}

export function forkPoint(base, git) {
  const points = [`refs/remotes/origin/${base}`, `refs/heads/${base}`]
    .map((ref) => attempt(git, ['merge-base', ref, 'HEAD']))
    .filter(Boolean)
  if (!points.length) throw new Error(`нет ни origin/${base}, ни ${base}`)
  // Несравнимые точки (база и origin разошлись) оставляют origin: он первый.
  return points.reduce((a, b) => (attempt(git, ['merge-base', '--is-ancestor', a, b]) === null ? a : b))
}

export function fingerprint(cwd, base, git = run(cwd)) {
  const point = forkPoint(base, git)
  const hash = createHash('sha256')
  // Без внешних программ сравнения и цвета: настройки пользователя не должны менять отпечаток.
  hash.update(git(['diff', '--binary', '--no-ext-diff', '--no-color', point]))
  const added = git(['ls-files', '-z', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean).sort()
  for (const file of added) {
    hash.update(`\0new ${file}\0`)
    hash.update(readFileSync(join(cwd, file)))
  }
  return hash.digest('hex')
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const point = args[0] === '--point'
  const [base, worktree = '.'] = point ? args.slice(1) : args
  if (!base) {
    console.error('fingerprint.mjs [--point] <база> [<worktree>]')
    process.exit(2)
  }
  try {
    const cwd = resolve(worktree)
    console.log(point ? forkPoint(base, run(cwd)) : fingerprint(cwd, base))
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message)
    process.exit(1)
  }
}
