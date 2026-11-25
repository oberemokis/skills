import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { fingerprint, forkPoint } from './fingerprint.mjs'

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

const head = (dir, ref = 'HEAD') => git(dir, 'rev-parse', ref).trim()
const point = (dir, base) => forkPoint(base, (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }))

test('задача на стопке поверх локальной ветки: точка на её вершине, чужие коммиты в дифф не идут', () => {
  const dir = repo()
  writeFileSync(join(dir, 'app.ts'), 'export const a = 2\n')
  git(dir, 'commit', '-q', '-am', 'нижняя задача, только локально')
  git(dir, 'branch', 'feature/PROJ-0')
  git(dir, 'switch', '-q', '-c', 'feature/PROJ-2')
  writeFileSync(join(dir, 'b.ts'), 'export const b = 1\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'верхняя задача')
  assert.equal(point(dir, 'feature/PROJ-0'), head(dir, 'feature/PROJ-0'))
  assert.throws(() => point(dir, 'feature/PROJ-9'), /нет ни origin\/feature\/PROJ-9/)
})

test('локальная база отстала от origin: точка от origin', () => {
  const dir = repo()
  git(dir, 'switch', '-q', 'main')
  writeFileSync(join(dir, 'app.ts'), 'export const a = 3\n')
  git(dir, 'commit', '-q', '-am', 'новое в origin')
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  git(dir, 'reset', '-q', '--hard', 'HEAD~1')
  git(dir, 'switch', '-q', 'feature/PROJ-1')
  git(dir, 'merge', '-q', 'origin/main')
  assert.equal(point(dir, 'main'), head(dir, 'origin/main'))
})

test('локальная база разошлась с origin: точка от origin', () => {
  const dir = repo()
  const base = head(dir)
  git(dir, 'switch', '-q', 'main')
  writeFileSync(join(dir, 'other.ts'), 'x\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'локальное в main')
  git(dir, 'switch', '-q', 'feature/PROJ-1')
  git(dir, 'merge', '-q', 'main')
  git(dir, 'switch', '-q', '-c', 'tmp', base)
  writeFileSync(join(dir, 'remote.ts'), 'y\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'новое в origin')
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  git(dir, 'switch', '-q', 'feature/PROJ-1')
  git(dir, 'merge', '-q', '--no-edit', 'origin/main')
  assert.equal(point(dir, 'main'), head(dir, 'origin/main'))
})
