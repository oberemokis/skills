// Панель задач task-fleet в сессии оркестратора: этап, состояние и то, чего задача
// ждёт от пользователя. Данные берутся из файлов задач task-run.
import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { FleetTask, StepStatus } from '../../types'

const PANE = 'fleet-panel'
const TITLE = 'Задачи fleet'
const REFRESH_MS = 3000
const MINUTE_MS = 60_000
// Закрытая задача висит в панели полдня, потом уходит: файлы задач копятся месяцами.
const CLOSED_VISIBLE_MS = 12 * 60 * MINUTE_MS

// Порядок этапов маршрута task-run, как в его SKILL.md.
const ROUTE = [
  'start',
  'worktree',
  'plan',
  'ask-product',
  'implement',
  'verify',
  'review',
  'audit',
  'show',
  'deliver',
  'close',
] as const

const STAGE_NAMES: Record<string, string> = {
  start: 'Взять задачу',
  worktree: 'Рабочая копия',
  plan: 'План',
  'ask-product': 'Вопрос продукту',
  implement: 'Реализация',
  verify: 'Автотесты',
  review: 'Ревью',
  audit: 'Аудит',
  show: 'Дифф и показ',
  deliver: 'Доставка',
  close: 'Закрытие',
}

type StatusLook = { label: string; color: Color }

const STATUS_LOOK: Record<string, StatusLook> = {
  'waiting-user': { label: 'ждёт тебя', color: 'warning' },
  blocked: { label: 'стоп', color: 'error' },
  running: { label: 'идёт', color: 'success' },
  'waiting-external': { label: 'ждёт внешнего', color: 'suggestion' },
  stopped: { label: 'остановлена', color: 'inactive' },
  done: { label: 'готово', color: 'success' },
}
const CLOSED_LOOK: StatusLook = { label: 'закрыта', color: 'inactive' }
const UNKNOWN_LOOK: StatusLook = { label: '?', color: 'inactive' }

// Сверху то, что ждёт человека.
const URGENCY = ['waiting-user', 'blocked', 'running', 'waiting-external', 'stopped', 'done']

const isOrchestrator = atom({ plugin: 'oberemokis-skills', key: 'fleetOrchestrator' } as const, false, {
  shape: 'orchestrator-1',
})
const root = atom({ plugin: 'oberemokis-skills', key: 'fleetRoot' } as const, '', { shape: 'root-1' })
const tasks = atom({ plugin: 'oberemokis-skills', key: 'fleetTasks' } as const, [], { shape: 'tasks-1' })
const nowMs = atom({ plugin: 'oberemokis-skills', key: 'fleetNow' } as const, 0, { shape: 'now-1' })

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function toTask(raw: unknown, cwd: string): FleetTask | null {
  if (!isFields(raw) || raw.fleet !== true) return null

  const id = text(raw.task)
  const worktree = text(raw.worktree)
  // Задачи этого оркестратора: их worktree лежат внутри папки его сессии.
  if (id === null || worktree === null || !worktree.startsWith(`${cwd}/`)) return null

  const stage = isFields(raw.stage) ? raw.stage : {}
  const stages = isFields(raw.stages) ? raw.stages : {}
  const statusOf = (code: string): string | null => {
    const entry = stages[code]

    return isFields(entry) ? text(entry.status) : null
  }
  const current = text(stage.code) ?? ''
  const steps: StepStatus[] = ROUTE.filter(code => {
    const status = statusOf(code)

    return status !== null && status !== 'skipped'
  }).map(code => {
    if (statusOf(code) === 'done') return 'done'

    return code === current ? 'current' : 'pending'
  })

  return {
    id,
    title: text(raw.title) ?? '',
    level: text(raw.level) ?? '',
    stage: current,
    status: text(stage.status) ?? '',
    waiting: text(stage.waiting),
    sinceMs: Date.parse(text(stage.since) ?? ''),
    steps,
    isClosed: statusOf('close') === 'done',
  }
}

function urgency(task: FleetTask): number {
  const index = URGENCY.indexOf(task.status)

  return task.isClosed ? URGENCY.length + 1 : index === -1 ? URGENCY.length : index
}

async function scan($: EngineInterface, cwd: string, now: number): Promise<FleetTask[]> {
  const home = await $.env.get('HOME')
  if (home === undefined) return []

  const base = `${home}/.local/state/task-run`
  const projects = await $.fs.list(base).catch(() => [])
  const found: FleetTask[] = []

  for (const project of projects) {
    if (project.kind !== 'dir') continue

    const dir = `${base}/${project.name}/tasks`
    const files = await $.fs.list(dir).catch(() => [])

    for (const file of files) {
      if (file.kind !== 'file' || !file.name.endsWith('.json')) continue

      // Файл задачи пишется через временный файл и переименование, но битый
      // файл соседней задачи не должен гасить всю панель.
      const raw = await $.fs
        .read(`${dir}/${file.name}`)
        .then(content => JSON.parse(content) as unknown)
        .catch(() => null)
      const task = toTask(raw, cwd)
      if (task === null) continue
      if (task.isClosed && now - task.sinceMs > CLOSED_VISIBLE_MS) continue

      found.push(task)
    }
  }

  return found.sort((a, b) => urgency(a) - urgency(b) || a.id.localeCompare(b.id))
}

async function refresh($: EngineInterface): Promise<void> {
  const cwd = await read($, root)
  if (cwd === '') return

  const now = await $.clock.now()
  const next = await scan($, cwd, now)
  const previous = await read($, tasks)
  // Перерисовка только при изменении: опрос идёт каждые три секунды.
  if (JSON.stringify(previous) !== JSON.stringify(next)) await update($, tasks, () => next)
  // «N мин назад» достаточно обновлять раз в минуту.
  if (now - (await read($, nowMs)) >= MINUTE_MS) await update($, nowMs, () => now)
}

// Модульные переменные сбрасываются при перезагрузке модуля, а таймеры старого
// модуля движок отменяет сам.
let isTicking = false

async function start($: EngineInterface): Promise<void> {
  await refresh($)
  if (isTicking) return

  isTicking = true
  $.clock.every(REFRESH_MS, () => void refresh($))
}

function ago(sinceMs: number, now: number): string {
  if (!Number.isFinite(sinceMs) || now === 0) return ''

  const minutes = Math.floor((now - sinceMs) / MINUTE_MS)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин`

  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `${hours} ч` : `${Math.floor(hours / 24)} д`
}

const STEP_MARK: Record<StepStatus, string> = { done: '●', current: '◐', pending: '○' }

function lookOf(task: FleetTask): StatusLook {
  if (task.isClosed) return CLOSED_LOOK

  return STATUS_LOOK[task.status] ?? UNKNOWN_LOOK
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, root, () => e.cwd)
    await $.command.register({
      name: 'fleet-panel',
      description: 'Открыть панель задач fleet этой папки',
    })
    // Перезагрузка модуля или продолжение сессии оркестратора: панель возвращается.
    if (await read($, isOrchestrator)) {
      await start($)
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  // Оркестратор узнаётся по запуску task-fleet: в сессиях задач идёт task-run.
  on('skill.prompt', async ($, e, next) => {
    if (/(^|:)task-fleet$/.test(e.skill)) {
      await update($, isOrchestrator, () => true)
      await start($)
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('command.run', { command: 'fleet-panel' }, async $ => {
    await update($, isOrchestrator, () => true)
    await start($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Панель задач fleet открыта.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, tasks)
    const now = await read($, nowMs)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Задач fleet в этой папке нет.</Text>
        </Box>
      )
    }

    const waitingCount = list.filter(task => !task.isClosed && task.status === 'waiting-user').length
    const activeCount = list.filter(task => !task.isClosed).length

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {`В работе ${activeCount}` + (waitingCount > 0 ? `, ждут тебя ${waitingCount}` : '')}
        </Text>
        {list.map(task => {
          const look = lookOf(task)
          const stageName = STAGE_NAMES[task.stage] ?? task.stage
          const since = ago(task.sinceMs, now)
          const bar = task.steps.map(step => STEP_MARK[step]).join('')

          return (
            <Box flexDirection="column" marginTop={1}>
              <Text wrap="truncate-end" bold dimColor={task.isClosed}>
                {`${task.id} ${task.level}  ${task.title}`}
              </Text>
              <Text wrap="truncate-end" color={look.color}>
                {`${bar}  ${stageName} · ${look.label}` + (since === '' ? '' : ` · ${since}`)}
              </Text>
              {task.waiting !== null && !task.isClosed && (
                <Text wrap="truncate-end" color={look.color}>
                  {`  ${task.waiting}`}
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
