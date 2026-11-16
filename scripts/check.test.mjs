// Проверка, которая тихо сломалась, хуже отсутствующей: однажды она уже смотрела в несуществующую папку
// и писала «утечек нет». Здесь на каждое замечание своя маленькая копия репозитория.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { check } from './check.mjs'

// Запрещённые формы собраны из частей: записанные целиком, они провалили бы проверку этого же файла.
const BAD_ID = ['TEAM', '42'].join('-')
const BAD_HOST = ['git', 'corp', 'studio'].join('.')
const BAD_USER = ['iv', 'an'].join('')

const skill = (name, extra = '', body = '') => `---\nname: ${name}\ndescription: "Тестовый скилл ${name}."\n${extra}---\n\n${body}\n`
const MANUAL = 'policy:\n  allow_implicit_invocation: false\n'

// Исправная копия: ссылки обоих видов, ручной скилл с парой для Codex, internal без пары, агент.
const VALID = {
  'skills/core/SKILL.md': skill('core', '', 'Пример ID: PROJ-123, хост git.example.org, путь /Users/me/project.'),
  'skills/grill/SKILL.md': skill('grill', 'disable-model-invocation: true\n', 'Сначала [core](../core/SKILL.md), затем `<папка скилла>/../core/SKILL.md`.'),
  'skills/grill/agents/openai.yaml': MANUAL,
  'skills/task-run/SKILL.md': skill('task-run', 'disable-model-invocation: true\nmetadata:\n  internal: true\n', 'Этапы в `stages/plan.md` и `../core/SKILL.md`.'),
  'skills/task-run/stages/plan.md': 'План. Ревью по `<папка скилла>/../grill/SKILL.md`, вызов `@grill` в коде не упоминание.',
  'agents/test-reviewer.md': '---\nname: test-reviewer\ndescription: "Ревьюер."\n---\n\nТекст.\n',
  'README.md': 'Скиллы: [core](skills/core/SKILL.md). Ручной вызов `/grill`, `@grill`, `$grill`.\n',
}

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'skills-check-'))
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

function problems(changes) {
  const root = repo({ ...VALID, ...changes })
  try {
    return check(root).problems
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('исправная копия проходит без замечаний', () => {
  assert.deepEqual(problems({}), [])
})

const cases = [
  ['битая markdown-ссылка', { 'skills/core/SKILL.md': skill('core', '', 'См. [нет](../nope/SKILL.md).') }, /битая ссылка \.\.\/nope\/SKILL\.md/],
  ['битая ссылка без ./ в начале', { 'README.md': 'См. [нет](skills/nope/SKILL.md).\n' }, /README\.md:1: битая ссылка skills\/nope/],
  ['битый путь в обратных кавычках от папки скилла', { 'skills/task-run/stages/plan.md': 'Читай `<папка скилла>/../review/SKILL.md`.' }, /битая ссылка <папка скилла>\/\.\.\/review/],
  ['битый относительный путь в обратных кавычках', { 'skills/task-run/stages/plan.md': 'Читай `../audit/SKILL.md`.' }, /битая ссылка \.\.\/audit\/SKILL\.md/],
  ['ID задачи проекта', { 'skills/core/SKILL.md': skill('core', '', `Как в ${BAD_ID}.`) }, new RegExp(`ID задачи ${BAD_ID}`)],
  ['внутренний хост', { 'skills/core/SKILL.md': skill('core', '', `Код на ${BAD_HOST}.`) }, new RegExp(`хост ${BAD_HOST}`)],
  ['личный путь', { 'skills/core/SKILL.md': skill('core', '', `Лежит в /Users/${BAD_USER}/work.`) }, new RegExp(`личный путь /Users/${BAD_USER}`)],
  ['упоминание человека в скилле только для Claude', { 'skills/task-run/stages/plan.md': 'Спроси @ivan.petrov.' }, /упоминание @ivan\.petrov/],
  ['упоминание человека в docs', { 'docs/flow.md': 'Решил @Иванов_Иван.\n' }, /упоминание @Иванов_Иван/],
  ['name не по стандарту', { 'skills/Core_1/SKILL.md': skill('Core_1') }, /name «Core_1» не по стандарту/],
  ['name не совпадает с папкой', { 'skills/core/SKILL.md': skill('base') }, /name «base» не совпадает с папкой/],
  ['ручной скилл без agents/openai.yaml', { 'skills/grill/agents/openai.yaml': null }, /disable-model-invocation без agents\/openai\.yaml/],
  ['agents/openai.yaml без disable-model-invocation', { 'skills/grill/SKILL.md': skill('grill') }, /ручной вызов в Codex, а в SKILL\.md нет/],
  ['папка скилла без SKILL.md', { 'skills/draft/notes.md': 'Черновик.' }, /skills\/draft: нет SKILL\.md/],
  ['агент без совпадающего name', { 'agents/test-reviewer.md': '---\nname: reviewer\ndescription: "Р."\n---\n' }, /agents\/test-reviewer\.md: name не совпадает/],
]

for (const [name, changes, expected] of cases) {
  test(`проверка падает: ${name}`, () => {
    const found = problems(changes)
    assert.ok(found.some((p) => expected.test(p)), `нет замечания ${expected} среди:\n${found.join('\n')}`)
  })
}

test('проверка падает, если папки skills нет вовсе', () => {
  const root = repo({ 'README.md': 'Пусто.\n' })
  try {
    assert.match(check(root).problems.join('\n'), /нет папки skills/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
