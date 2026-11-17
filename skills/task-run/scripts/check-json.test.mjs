import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkDocument } from './check-json.mjs'

function validTask() {
  return {
    schema: 'task-run/task@1',
    project: 'app',
    task: 'PROJ-12',
    title: 'Фильтр по камерам',
    type: 'feature',
    level: 'M',
    levelReason: 'три файла, без контракта',
    base: 'main',
    delivery: 'mr',
    branch: 'feature/PROJ-12',
    worktree: '/repo/.worktrees/feature-PROJ-12',
    fleet: true,
    session: { agent: 'feature-proj-12', workspace: 'w1', pane: 'w1:p1', claudeSession: 'abc' },
    stage: { code: 'implement', status: 'running', waiting: null, since: '2026-11-12T18:00:00+03:00' },
    stages: {
      start: { status: 'done', at: '2026-11-12T17:40:00+03:00' },
      plan: { status: 'done', at: '2026-11-12T17:45:00+03:00' },
      implement: { status: 'running', at: '2026-11-12T18:00:00+03:00' },
    },
    context: {
      goal: 'Фильтр списка камер по статусу',
      criteria: ['выбор «онлайн» оставляет только камеры онлайн'],
      cases: [{ case: 'фильтр «онлайн»', seam: 'страница списка', test: 'компонентный' }],
      decisions: [],
      openQuestions: [],
      epicDoc: null,
      memory: [],
    },
    findings: [],
    hypothesis: null,
    fixRounds: 0,
    cause: null,
    pending: null,
    outbound: [],
    reviewedDiff: null,
    commit: null,
    mrs: [],
  }
}

function validProject() {
  return {
    schema: 'task-run/project@1',
    project: 'app',
    remotes: ['host.org/team/app'],
    taskId: 'PROJ-\\d+',
    branch: 'feature/{id}',
    base: 'main',
    commit: '{id} {summary}',
    tracker: { kind: 'youtrack', check: 'get_current_user' },
    codeHost: { kind: 'gitlab', host: 'host.org', check: 'glab auth status' },
    worktree: { dir: '.worktrees', localFiles: [], install: [], exclude: [] },
    checks: { front: { paths: ['web/**'], run: ['pnpm lint'] } },
    stand: null,
  }
}

const PRINT = 'a'.repeat(64)

function withCase(result) {
  const task = validTask()
  task.context.cases[0].result = result
  return task
}

const cases = [
  ['полный файл задачи', validTask, []],
  ['полный файл проекта', validProject, []],
  [
    'задача без context, как неполный файл старой очереди',
    () => {
      const task = validTask()
      delete task.context
      return task
    },
    ['$: нет поля context'],
  ],
  [
    'неизвестный код этапа',
    () => ({ ...validTask(), stage: { ...validTask().stage, code: 'queue' } }),
    ['$.stage.code: допустимо'],
  ],
  [
    'ожидание без текста, чего ждём',
    () => ({ ...validTask(), stage: { ...validTask().stage, status: 'waiting-user', waiting: null } }),
    ['$.stage.waiting: ожидался string'],
  ],
  [
    'доставка закрыта без коммита',
    () => ({ ...validTask(), stages: { ...validTask().stages, deliver: { status: 'done', at: 'x' } } }),
    ['$.commit: ожидался string'],
  ],
  [
    'доставка через MR закрыта без MR',
    () => ({ ...validTask(), commit: 'abc1234', stages: { ...validTask().stages, deliver: { status: 'done', at: 'x' } } }),
    ['$.mrs: нужно не меньше 1'],
  ],
  [
    'доставка push закрыта без MR',
    () => ({
      ...validTask(),
      delivery: 'push',
      commit: 'abc1234',
      stages: { ...validTask().stages, deliver: { status: 'done', at: 'x' } },
    }),
    [],
  ],
  [
    'сессия другого агента: вид и ID сессии рядом со старыми полями',
    () => ({ ...validTask(), session: { ...validTask().session, claudeSession: null, agentKind: 'codex', agentSession: '019a1e67-ec48-7000-8000-000000000001' } }),
    [],
  ],
  ['неизвестный вид агента', () => ({ ...validTask(), session: { ...validTask().session, agentKind: 'cursor' } }), ['$.session.agentKind: допустимо']],
  ['агент проекта по умолчанию', () => ({ ...validProject(), agent: 'codex' }), []],
  ['неизвестный агент проекта', () => ({ ...validProject(), agent: 'cursor' }), ['$.agent: допустимо']],
  [
    'результат случая привязан к отпечатку диффа',
    () => withCase({ status: 'pass', diff: PRINT, at: '2026-11-17T12:00:00+03:00', check: 'pnpm vitest run cameras' }),
    [],
  ],
  [
    'случай без прогона без причины',
    () => withCase({ status: 'not_run', diff: PRINT, at: 'x', check: 'pnpm vitest run cameras' }),
    ['$.context.cases[0].result: нет поля note'],
  ],
  [
    'неприменимый случай с причиной',
    () => withCase({ status: 'not_applicable', diff: PRINT, at: 'x', check: 'нет', note: 'критерий снят продуктом' }),
    [],
  ],
  ['результат без отпечатка', () => withCase({ status: 'pass', diff: 'abc', at: 'x', check: 'y' }), ['$.context.cases[0].result.diff: не подходит']],
  ['отпечаток прогона всех проверок', () => ({ ...validTask(), verifiedDiff: PRINT }), []],
  [
    'допущение с проверкой и ценой ошибки',
    () => ({
      ...validTask(),
      context: {
        ...validTask().context,
        assumptions: [{ claim: 'статус камеры приходит в списке', check: 'ответ /api/cameras', ifFalse: 'нужен второй запрос', status: 'unchecked' }],
      },
    }),
    [],
  ],
  [
    'допущение без цены ошибки',
    () => ({ ...validTask(), context: { ...validTask().context, assumptions: [{ claim: 'x', check: 'y', status: 'confirmed' }] } }),
    ['$.context.assumptions[0]: нет поля ifFalse'],
  ],
  ['лишнее поле в задаче', () => ({ ...validTask(), mr: 12 }), ['$: лишнее поле mr']],
  ['пустой список критериев', () => ({ ...validTask(), context: { ...validTask().context, criteria: [] } }), ['$.context.criteria: нужно не меньше 1']],
  [
    'страницы стенда для вкладки',
    () => ({ ...validTask(), context: { ...validTask().context, pages: ['/cameras?status=online'] } }),
    [],
  ],
  [
    'страница стенда полным адресом',
    () => ({ ...validTask(), context: { ...validTask().context, pages: ['http://localhost:3000/cameras'] } }),
    ['$.context.pages[0]: не подходит'],
  ],
  ['чужая схема', () => ({ ...validTask(), schema: 'task-queue' }), ['$.schema: неизвестная схема']],
  ['проект без адресов', () => ({ ...validProject(), remotes: [] }), ['$.remotes: нужно не меньше 1']],
  ['шаблон ветки без ID', () => ({ ...validProject(), branch: 'feature/x' }), ['$.branch: не подходит']],
  [
    'стенд без порта',
    () => ({ ...validProject(), stand: { cwd: 'web', start: 'pnpm dev' } }),
    ['$.stand: нет поля port'],
  ],
]

for (const [name, build, expected] of cases) {
  test(`проверка: ${name}`, () => {
    const errors = checkDocument(build())

    if (expected.length === 0) {
      assert.deepEqual(errors, [])
      return
    }

    for (const fragment of expected) {
      assert.ok(
        errors.some((error) => error.startsWith(fragment)),
        `ждали ошибку «${fragment}…», получили: ${JSON.stringify(errors)}`,
      )
    }
  })
}

const script = fileURLToPath(new URL('./check-json.mjs', import.meta.url))

function commit(document) {
  const dir = mkdtempSync(join(tmpdir(), 'task-run-check-'))
  const file = join(dir, 'PROJ-12.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(document))

  const result = spawnSync(process.execPath, [script, '--commit', `${file}.tmp`], { encoding: 'utf8' })
  return { result, file }
}

test('--commit кладёт валидный файл на место', () => {
  const { result, file } = commit(validTask())

  assert.equal(result.status, 0)
  assert.equal(existsSync(`${file}.tmp`), false)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).task, 'PROJ-12')
})

test('--commit не трогает прежний файл, если новый невалиден', () => {
  const broken = validTask()
  delete broken.context
  const { result, file } = commit(broken)

  assert.equal(result.status, 1)
  assert.equal(existsSync(file), false)
  assert.equal(existsSync(`${file}.tmp`), true)
})
