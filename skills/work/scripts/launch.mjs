#!/usr/bin/env node
// Запускает сессию задачи в своём пространстве herdr: проверяет дубль, считает места,
// создаёт пространство, метит панель и ждёт, пока агент в ней будет готов. Звать под локом мест:
//
//   flock -w 20 -E 75 ~/.local/state/task-run/work.lock node launch.mjs \
//     --name <имя> --cwd <worktree> --task <ID> [--agent claude] [--task-args '<ID> --work …'] \
//     [--session <id> [--resume]] [--replace] [--limit 3] [--timeout 60] [--budget 90] \
//     -- [аргументы агента и промпт]
//
// --task-args: скрипт сам собирает промпт task-run в синтаксисе агента (`/task-run …` у Claude),
// оркестратор не знает синтаксисов и не думает о кавычках. Без него промпт идёт после -- как есть.
// --replace: в панели задачи, из которой агент вышел, осталась оболочка, агент стартует в ней заново.
// Скрипт держит лок, пока ждёт агента: иначе второй оркестратор не посчитает новую сессию.
// Вывод: JSON одной строкой. Код выхода 0: запущен; 4: мест нет; 5: у задачи уже есть панель
// (с живым агентом, или без него и без --replace); 6: агент не стал готов или вышел сразу, его процесс
// погашен; 2: ошибка вызова; 1: herdr ответил ошибкой.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { bind, profile } from '../../task-run/scripts/remote.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Метки панели задачи: источник метаданных herdr и метка, по которой work узнаёт свои панели.
export const SOURCE = 'work'
export const MARK = 'work'

// Агенты сессий задач. Ключ совпадает с видом агента в herdr (`--kind`), herdr сам набирает его программу.
export const AGENTS = {
  claude: {
    args: [],
    // argv[0] процесса. Имя процесса у Claude равно номеру версии, поэтому argv.
    program: /(^|\/)claude$/,
    newSession: () => randomUUID(),
    session: UUID,
    start: (id) => ['--session-id', id],
    resume: (id) => ['--resume', id],
    prompt: (skill, args) => `/${skill} ${args}`,
    trust: /trust this folder/i,
  },
  opencode: {
    args: ['--standalone'],
    program: /(^|\/)opencode$/,
    newSession: () => `ses_${randomUUID().replaceAll('-', '').slice(0, 26)}`,
    session: /^ses_[A-Za-z0-9]+$/,
    start: (id) => ['--session', id],
    resume: (id) => ['--session', id],
    prompt: (skill, args) => `@${skill} ${args}`,
    trust: /trust this (folder|directory)/i,
  },
}

// Фоновые серверы агентов называются так же, как сами агенты, но сессией не являются.
const SERVER = /\s(serve|app-server)(\s|$)/

const kindOf = (argv0) => Object.keys(AGENTS).find((kind) => AGENTS[kind].program.test(argv0 ?? '')) ?? null

// Процессы машины: pid, родитель, состояние и argv.
export function readProcs() {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat=,args='], { encoding: 'utf8' })
  return out.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(.*)$/)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), stat: match[3], argv0: match[4], args: match[4] + match[5] }] : []
  })
}

// Процесс агента в дереве оболочки панели (`shell_pid` из `herdr pane process-info`).
// Не процессы переднего плана: после Ctrl+Z агент из них уходит, а сессия жива.
export function agentProcess(root, procs = []) {
  if (!root) return null
  const children = new Map()
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])
  const queue = [...(children.get(root) ?? [])]
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]
    const kind = kindOf(p.argv0)
    if (kind && !SERVER.test(p.args)) return { pid: p.pid, kind, stopped: p.stat.includes('T') }
    queue.push(...(children.get(p.pid) ?? []))
  }
  return null
}

// Папка внутри worktree: в пути есть сегмент worktree.dir и что-то после него.
export const insideWorktree = (cwd, dirs) =>
  typeof cwd === 'string' && dirs.some((dir) => cwd.includes(`/${dir}/`))

// Живая сессия занимает место: агент в панели work или в папке worktree любого проекта.
// Агента в панели herdr видит сам, в том числе на вопросе о доверии и после Ctrl+Z.
export const liveSessions = (panes, dirs) =>
  panes.filter((p) => p.agent && (p.tokens?.[MARK] === '1' || insideWorktree(p.foreground_cwd, dirs)))

// Вопрос о доверии папке на экране агента: отвечает на него человек.
export const asksTrust = (screen, kind = 'claude') => AGENTS[kind].trust.test(screen)

const promptOf = ({ agent, taskArgs, estimateFirst, project }) =>
  taskArgs && AGENTS[agent].prompt(estimateFirst ? 'task-estimate' : 'task-run', taskArgs + (project ? ` --project ${project}` : ''))

// Метки панели: по ним work находит задачу, её агента и сессию, а подсчёт мест отличает свои панели.
export function tokens({ task, agent, session, project }) {
  return [
    `${MARK}=1`,
    `task=${task}`,
    `agent=${agent}`,
    ...(project ? [`project=${project}`] : []),
    ...(session ? [`agent-session=${session}`] : []),
  ]
}

export function startArgs(opts, pane, ms) {
  const { name, agent, session, resume, agentArgs } = opts
  const a = AGENTS[agent]
  const prompt = promptOf(opts)
  const tail = agent === 'opencode'
    ? ['--prompt', prompt || agentArgs[0]]
    : [...agentArgs, ...(prompt ? [prompt] : [])]
  return [
    'agent', 'start', name, '--kind', agent, '--pane', pane, '--timeout', String(ms),
    '--', ...a.args,
    ...(session ? (resume ? a.resume(session) : a.start(session)) : []),
    ...tail,
  ]
}

export function options(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      cwd: { type: 'string' },
      project: { type: 'string' },
      branch: { type: 'string' },
      task: { type: 'string' },
      agent: { type: 'string', default: 'claude' },
      'task-args': { type: 'string' },
      'estimate-first': { type: 'boolean', default: false },
      session: { type: 'string' },
      resume: { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
      limit: { type: 'string', default: '3' },
      timeout: { type: 'string', default: '60' },
      budget: { type: 'string', default: '90' },
    },
  })
  const { name, cwd, task, agent } = values
  // Имя агента в herdr: с буквы, до 32 знаков, уникально среди живых агентов.
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name ?? '')) throw new Error('--name: до 32 знаков [a-z0-9_-], первая буква')
  if (!cwd || !isAbsolute(cwd)) throw new Error('--cwd: абсолютный путь к worktree')
  if (!/^[A-Za-z0-9._-]+$/.test(task ?? '')) throw new Error('--task: ID задачи или read-<имя>')
  if (!Object.hasOwn(AGENTS, agent)) throw new Error(`--agent: один из ${Object.keys(AGENTS).join(', ')}`)
  const a = AGENTS[agent]
  // Новой сессии ID выдаёт скрипт: uuidgen хук lean-ctx не пропускает. Перезапуск берёт прежний.
  if (values.resume && !values.session) throw new Error('--resume: нужен --session прежней сессии')
  const session = values.session ?? a.newSession()
  if (!a.session.test(session)) throw new Error(`--session: не ID сессии ${agent}`)
  const taskArgs = values['task-args'] ?? null
  if (values.project !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(values.project)) throw new Error('--project: нужно имя профиля')
  if (agent === 'opencode' && (task.startsWith('read-') || (taskArgs ? positionals.length : positionals.length !== 1))) {
    throw new Error('OpenCode: нужна задача с --task-args или один промпт продолжения')
  }
  if (taskArgs !== null && !taskArgs.trim()) throw new Error('--task-args: пусто')
  if (values['estimate-first'] && (!taskArgs || values.resume || task.startsWith('read-'))) {
    throw new Error('--estimate-first: нужна задача с --task-args без --resume')
  }
  const limit = Number(values.limit)
  const timeout = Number(values.timeout)
  const budget = Number(values.budget)
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit: целое больше нуля')
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('--timeout: секунды больше нуля')
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget: секунды больше нуля')
  return {
    name, cwd, task, agent, session, taskArgs, project: values.project, branch: values.branch, estimateFirst: values['estimate-first'], resume: values.resume, replace: values.replace,
    limit, timeout, budget, agentArgs: positionals,
  }
}

export class HerdrError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// Ответ herdr: `result` при успехе (у `report-metadata` пусто), ошибка с кодом из JSON в stderr при отказе.
export function herdr(args) {
  try {
    const out = execFileSync('herdr', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return out.trim() ? JSON.parse(out).result : null
  } catch (error) {
    const stderr = error.stderr?.toString() ?? ''
    let parsed = null
    try {
      parsed = JSON.parse(stderr).error
    } catch {
      // Не JSON: ошибка разбора аргументов или herdr не запущен.
    }
    throw new HerdrError(parsed?.code ?? 'failed', parsed?.message ?? (stderr.trim() || error.message))
  }
}

export const panes = () => herdr(['api', 'snapshot']).snapshot.panes ?? []
export const ownPanes = () => panes().filter((p) => p.tokens?.[MARK] === '1')
const pane = (id) => herdr(['pane', 'get', id]).pane

// Процесс агента в панели: от оболочки панели вниз по дереву.
export function paneAgent(id, procs = readProcs()) {
  const info = herdr(['pane', 'process-info', '--pane', id]).process_info
  return agentProcess(info.shell_pid, procs)
}

const signal = (pid, name, kill) => {
  try {
    kill(pid, name)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

// Гасит агента: TERM, затем CONT, иначе остановленный по Ctrl+Z процесс TERM не получит до продолжения.
// Оболочка панели остаётся, пространство с ней тоже.
export function stopAgent(proc, kill = process.kill) {
  for (const name of ['SIGTERM', 'SIGCONT']) signal(proc.pid, name, kill)
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// Гасит агента и ждёт выхода. Остановленный по Ctrl+Z агент fish после CONT снова останавливает,
// и TERM до него не доходит: такого добивает KILL.
export async function stopAndWait(proc, seconds) {
  stopAgent(proc)
  if (await poll(() => !alive(proc.pid), seconds)) return 'stopped'
  signal(proc.pid, 'SIGKILL', process.kill)
  return (await poll(() => !alive(proc.pid), 3)) ? 'killed' : 'alive'
}

function worktreeDirs() {
  const root = process.env.TASK_RUN_STATE ?? join(homedir(), '.local/state/task-run')
  const dirs = new Set()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const dir = JSON.parse(readFileSync(join(root, entry.name, 'project.json'), 'utf8')).worktree?.dir
      if (typeof dir === 'string' && dir.trim()) dirs.add(dir.replace(/^\/+|\/+$/g, ''))
    } catch {
      // Сломанный project.json разбирает опросник проекта, здесь он просто не даёт папок.
    }
  }
  return [...dirs]
}

export async function poll(fn, seconds) {
  const end = Date.now() + seconds * 1000
  for (;;) {
    const value = fn()
    if (value) return value
    if (Date.now() >= end) return null
    await sleep(500)
  }
}

class Exit {
  constructor(code, result) {
    this.code = code
    this.result = result
  }
}

async function launch(opts) {
  // Весь запуск укладывается в бюджет: команду оркестратора инструмент убивает на 120 с.
  const deadline = Date.now() + opts.budget * 1000
  const left = (seconds) => Math.max(0, Math.min(seconds, (deadline - Date.now()) / 1000))

  // Перезапуск: агент из панели вышел, в ней осталась оболочка, агент стартует в ней же.
  let target = null
  for (const p of ownPanes().filter((p) => p.tokens?.task === opts.task)) {
    const alive = Boolean(p.agent)
    if (alive || !opts.replace) {
      throw new Exit(5, { status: 'exists', pane: p.pane_id, workspace: p.workspace_id, alive, agent: p.tokens?.agent ?? null })
    }
    target = p
  }

  const live = liveSessions(panes(), worktreeDirs())
  if (live.length >= opts.limit) {
    throw new Exit(4, {
      status: 'full',
      limit: opts.limit,
      live: live.map((p) => ({ pane: p.pane_id, task: p.tokens?.task ?? null, cwd: p.foreground_cwd ?? null })),
    })
  }

  if (!target) {
    const created = herdr(['workspace', 'create', '--cwd', opts.cwd, '--label', `work-${opts.name}`, '--no-focus'])
    target = { pane_id: created.root_pane.pane_id, workspace_id: created.workspace.workspace_id }
  }
  const id = target.pane_id
  herdr(['pane', 'report-metadata', id, '--source', SOURCE, ...tokens(opts).flatMap((t) => ['--token', t])])
  const base = { pane: id, workspace: target.workspace_id, name: opts.name, agent: opts.agent, session: opts.session }

  const ms = Math.min(300000, Math.max(1000, Math.round(left(opts.timeout) * 1000)))
  try {
    herdr(startArgs(opts, id, ms))
    return { status: 'started', ...base, ready: true, trust: false }
  } catch (error) {
    if (!(error instanceof HerdrError)) throw error
    // Агент запущен, но встал на вопросе при старте: чаще всего о доверии папке.
    if (error.code === 'agent_not_ready') {
      // `pane read` отдаёт текст экрана, а не JSON.
      const screen = execFileSync('herdr', ['pane', 'read', id, '--source', 'visible', '--lines', '60'], { encoding: 'utf8' })
      return { status: 'started', ...base, ready: false, trust: asksTrust(screen, opts.agent) }
    }
    if (error.code !== 'timeout') throw new Exit(1, { status: 'error', ...base, message: error.message })
    const present = Boolean(pane(id).agent)
    const proc = paneAgent(id)
    if (proc) await stopAndWait(proc, 5)
    throw new Exit(6, { status: 'no-agent', ...base, reason: present ? 'timeout' : 'exited' })
  }
}

async function main() {
  let opts
  try {
    opts = options(process.argv.slice(2))
    if (opts.project) {
      const p = profile(opts.project)
      if (p.data.execution?.mode === 'ssh') {
        if (opts.task.startsWith('read-')) throw new Error('SSH: режим без задачи не поддерживается')
        opts.cwd = bind(p, opts.task, opts.cwd, opts.branch)
      } else if (existsSync(join(p.dir, 'control', opts.task, 'binding.json'))) {
        throw new Error('у задачи есть привязка SSH; переключение на локальный checkout запрещено')
      }
    }
    if (!statSync(opts.cwd).isDirectory()) throw new Error(`--cwd: ${opts.cwd} не папка`)
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }

  let code = 0
  let result
  try {
    result = await launch(opts)
  } catch (error) {
    if (error instanceof HerdrError) ({ code, result } = { code: 1, result: { status: 'error', message: error.message } })
    else if (error instanceof Exit) ({ code, result } = error)
    else throw error
  }
  if (code === 1) console.error(result.message)
  console.log(JSON.stringify(result))
  process.exit(code)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
