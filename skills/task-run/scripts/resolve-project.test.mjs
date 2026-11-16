import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findProject, normalizeRemote } from './resolve-project.mjs'

const remotes = [
  ['https', 'https://git.example.org/team/app', 'git.example.org/team/app'],
  ['https с .git', 'https://git.example.org/team/app.git', 'git.example.org/team/app'],
  ['https с логином и токеном', 'https://oauth2:secret@git.example.org/team/app.git', 'git.example.org/team/app'],
  ['ssh в форме scp', 'git@git.example.org:team/app.git', 'git.example.org/team/app'],
  ['ssh с портом', 'ssh://git@git.example.org:2222/team/app.git', 'git.example.org/team/app'],
  ['регистр и слеш в конце', 'HTTPS://Git.Example.org/Team/App/', 'git.example.org/team/app'],
  ['вложенная группа', 'git@host.org:group/sub/app.git', 'host.org/group/sub/app'],
]

for (const [name, input, expected] of remotes) {
  test(`адрес origin нормализуется: ${name}`, () => {
    assert.equal(normalizeRemote(input), expected)
  })
}

test('токен из адреса не попадает в нормализованный вид', () => {
  assert.ok(!normalizeRemote('https://user:token123@host.org/a/b.git').includes('token123'))
})

function stateWith(projects) {
  const dir = mkdtempSync(join(tmpdir(), 'task-run-state-'))

  for (const [name, content] of Object.entries(projects)) {
    mkdirSync(join(dir, name))
    writeFileSync(join(dir, name, 'project.json'), content)
  }

  return dir
}

test('проект находится по любому из своих адресов', () => {
  const dir = stateWith({
    app: JSON.stringify({ remotes: ['host.org/team/app', 'mirror.org/team/app'] }),
    other: JSON.stringify({ remotes: ['host.org/team/other'] }),
  })

  const { match } = findProject('git@mirror.org:team/app.git', dir)
  assert.equal(match?.project, 'app')
})

test('чужой адрес даёт пустой ответ без ошибок', () => {
  const dir = stateWith({ app: JSON.stringify({ remotes: ['host.org/team/app'] }) })

  assert.deepEqual(findProject('https://host.org/team/unknown.git', dir), { match: null, broken: [] })
})

test('битый project.json называется, а не пропускается молча', () => {
  const dir = stateWith({ app: '{ не json', other: JSON.stringify({ remotes: ['host.org/team/other'] }) })

  const { match, broken } = findProject('https://host.org/team/app.git', dir)
  assert.equal(match, null)
  assert.equal(broken.length, 1)
  assert.ok(broken[0].endsWith(join('app', 'project.json')))
})

test('папки состояния нет: проекта нет, ошибки нет', () => {
  assert.deepEqual(findProject('https://host.org/a/b', join(tmpdir(), 'task-run-no-such-dir')), { match: null, broken: [] })
})
