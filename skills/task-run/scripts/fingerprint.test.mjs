import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { fingerprint } from './fingerprint.mjs'

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.org', ...args], { encoding: 'utf8' })

// Репозиторий с базой `origin/main` и веткой задачи поверх неё.
function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'fingerprint-')))
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'app.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, '.gitignore'), 'dist/\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'база')
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  git(dir, 'switch', '-q', '-c', 'feature/PROJ-1')
  return dir
}

test('коммит правок отпечаток не меняет: дифф считается от merge-base', () => {
  const dir = repo()
  writeFileSync(join(dir, 'app.ts'), 'export const a = 2\n')
  const before = fingerprint(dir, 'main')
  git(dir, 'commit', '-q', '-am', 'правка')
  assert.equal(fingerprint(dir, 'main'), before)
})

test('правка отслеживаемого файла меняет отпечаток', () => {
  const dir = repo()
  const clean = fingerprint(dir, 'main')
  writeFileSync(join(dir, 'app.ts'), 'export const a = 2\n')
  assert.notEqual(fingerprint(dir, 'main'), clean)
})

test('новый файл входит в отпечаток содержимым, игнорируемый не входит', () => {
  const dir = repo()
  writeFileSync(join(dir, 'new.ts'), 'export const b = 1\n')
  const first = fingerprint(dir, 'main')
  writeFileSync(join(dir, 'new.ts'), 'export const b = 2\n')
  const second = fingerprint(dir, 'main')
  assert.notEqual(second, first)

  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'out.js'), 'build\n')
  assert.equal(fingerprint(dir, 'main'), second)
})
