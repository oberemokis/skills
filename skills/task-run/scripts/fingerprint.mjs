#!/usr/bin/env node
// Отпечаток диффа задачи: всё, чем рабочая копия отличается от merge-base с базой, вместе с новыми
// файлами и их содержимым. Один и тот же для одобренного показа (`reviewedDiff`) и результатов
// тестовых случаев: правка любого файла задачи меняет отпечаток, и прежний pass перестаёт считаться.
// Коммит отпечаток не меняет: дифф считается от merge-base, а не от HEAD.
//
//   fingerprint.mjs <база> [<worktree>]
//
// Вывод: sha256 одной строкой. Код выхода 2: ошибка вызова; 1: git ответил ошибкой.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const run = (cwd) => (args) =>
  execFileSync('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], { maxBuffer: 512 * 1024 * 1024 })

export function fingerprint(cwd, base, git = run(cwd)) {
  const mergeBase = git(['merge-base', `origin/${base}`, 'HEAD']).toString().trim()
  const hash = createHash('sha256')
  // Без внешних программ сравнения и цвета: настройки пользователя не должны менять отпечаток.
  hash.update(git(['diff', '--binary', '--no-ext-diff', '--no-color', mergeBase]))
  const added = git(['ls-files', '-z', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean).sort()
  for (const file of added) {
    hash.update(`\0new ${file}\0`)
    hash.update(readFileSync(join(cwd, file)))
  }
  return hash.digest('hex')
}

if (import.meta.main) {
  const [base, worktree = '.'] = process.argv.slice(2)
  if (!base) {
    console.error('fingerprint.mjs <база> [<worktree>]')
    process.exit(2)
  }
  try {
    console.log(fingerprint(resolve(worktree), base))
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message)
    process.exit(1)
  }
}
