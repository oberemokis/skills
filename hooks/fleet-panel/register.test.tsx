import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const ROOT = '/repo'
const HOME = '/home/me'
const BASE = `${HOME}/.local/state/task-run`
const TASKS = `${BASE}/app/tasks`
const NOW = Date.parse('2026-11-12T18:10:00Z')

const PANE = {
  plugin: 'oberemokis-skills',
  component: 'Pane',
  requestId: 'fleet-panel',
  props: {
    title: 'Задачи fleet',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const FILES: Record<string, unknown> = {
  'PROJ-1.json': {
    fleet: true,
    task: 'PROJ-1',
    title: 'Фильтр камер',
    level: 'M',
    worktree: `${ROOT}/.worktrees/feature-PROJ-1`,
    stage: { code: 'show', status: 'waiting-user', waiting: 'Посмотри дифф и вкладку', since: '2026-11-12T18:00:00Z' },
    stages: {
      start: { status: 'done' },
      plan: { status: 'done' },
      implement: { status: 'done' },
      audit: { status: 'skipped' },
      show: { status: 'running' },
      deliver: { status: 'pending' },
    },
  },
  'PROJ-2.json': {
    fleet: true,
    task: 'PROJ-2',
    title: 'Чужая папка',
    worktree: '/other/.worktrees/feature-PROJ-2',
    stage: { code: 'implement', status: 'running', since: '2026-11-12T18:00:00Z' },
    stages: {},
  },
  'PROJ-3.json': {
    fleet: false,
    task: 'PROJ-3',
    title: 'Без fleet',
    worktree: `${ROOT}/.worktrees/feature-PROJ-3`,
    stage: { code: 'implement', status: 'running', since: '2026-11-12T18:00:00Z' },
    stages: {},
  },
  'broken.json': '{ не json',
}

type On = Parameters<TestBody>[1]

function engine(on: On, opened: string[]): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('command.register', () => ({ value: { command: 'fleet-panel' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('env.get', () => ({ value: HOME }))
  on('clock.now', () => ({ value: NOW }))
  // Отказ первого периода заканчивает интервал: тесту хватает первого чтения.
  on('clock.every', () => ({ deny: 'no timers in tests' }))
  on('fs.list', (_, e) => {
    if (e.path === BASE) return { value: [{ name: 'app', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (e.path === TASKS) {
      return {
        value: Object.keys(FILES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
      }
    }

    return { deny: 'missing' }
  })
  on('fs.read', (_, e) => {
    const content = FILES[e.path.slice(TASKS.length + 1)]
    if (content === undefined) return { deny: 'missing' }

    return { value: typeof content === 'string' ? content : JSON.stringify(content) }
  })
}

test('task-fleet открывает панель с задачами этой папки', async ($, on) => {
  const opened: string[] = []
  engine(on, opened)

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ skill: 'oberemokis-skills:task-fleet', text: 'fleet', frontmatter: {} })

  expect(opened).toEqual(['fleet-panel'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^PROJ-1/ }))?.text).toBe('PROJ-1 M  Фильтр камер')
  expect((await ui.find({ type: 'Text', text: /Дифф и показ/ }))?.text).toBe('●●●◐○  Дифф и показ · ждёт тебя · 10 мин')
  expect((await ui.find({ type: 'Text', text: /Посмотри/ }))?.text).toBe('  Посмотри дифф и вкладку')
  expect(await ui.find({ type: 'Text', text: /PROJ-2|PROJ-3/ })).toBeUndefined()
  await ui.unmount()
})

test('в сессии задачи панель не открывается', async ($, on) => {
  const opened: string[] = []
  engine(on, opened)

  await $.session.start({ cwd: `${ROOT}/.worktrees/feature-PROJ-1`, surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ skill: 'oberemokis-skills:task-run', text: 'run', frontmatter: {} })

  expect(opened).toEqual([])
})
