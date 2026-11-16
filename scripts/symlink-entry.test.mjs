// Скиллы стоят у агентов ссылками на этот клон. Скрипт, который решает «я главный модуль» сравнением
// argv[1] с путём модуля, через ссылку молча выходит с кодом 0: Node отдаёт путь модуля по realpath.
// Каждый скрипт без аргументов обязан что-то сказать: результат или ошибку вызова.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', 'skills')

const scripts = readdirSync(root).flatMap((skill) => {
  const dir = join(root, skill, 'scripts')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.mjs') && !file.endsWith('.test.mjs'))
    .map((file) => [skill, file])
})

const tmp = mkdtempSync(join(tmpdir(), 'skills-link-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

const run = (path) => spawnSync(process.execPath, [path], { cwd: tmp, encoding: 'utf8', timeout: 10_000 })

for (const [skill, file] of scripts) {
  test(`${skill}/scripts/${file}: через ссылку на папку скилла ведёт себя как напрямую`, () => {
    const link = join(tmp, skill)
    if (!existsSync(link)) symlinkSync(join(root, skill), link)
    const direct = run(join(root, skill, 'scripts', file))
    const linked = run(join(link, 'scripts', file))
    assert.notEqual(linked.stdout + linked.stderr, '', 'через ссылку скрипт молчит')
    assert.equal(linked.status, direct.status)
    assert.equal(linked.stdout, direct.stdout)
  })
}
