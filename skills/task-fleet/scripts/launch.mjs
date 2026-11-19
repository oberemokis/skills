#!/usr/bin/env node
// Запускает сессию задачи fleet в своём пространстве Herdr: проверяет дубль, считает места,
// делает `hc run` и ждёт, пока в терминале появится агент. Звать под локом мест:
//
//   flock -w 20 -E 75 ~/.local/state/task-run/fleet.lock node launch.mjs \
//     --name <имя> --cwd <worktree> --task <ID> [--agent claude] [--task-args '<ID> --fleet …'] \
//     [--session <id> [--resume]] [--replace] [--limit 3] [--timeout 60] [--budget 90] \
//     -- [аргументы агента и промпт]
//
// --task-args: скрипт сам собирает промпт task-run в синтаксисе агента (`/task-run …` у Claude),
// оркестратор не знает синтаксисов и не думает о кавычках. Без него промпт идёт после -- как есть.
// --replace: терминал задачи, из которого агент вышел, закрывается и запускается заново.
// Скрипт держит лок, пока ждёт агента: иначе второй оркестратор не посчитает новую сессию.
// Обёртка с оболочкой собирается здесь, а не в команде агента: встроенный код `sh -c` хук lean-ctx
// не пропускает.
// Вывод: JSON одной строкой. Код выхода 0: запущен; 4: мест нет; 5: у задачи уже есть терминал
// (с живым агентом, или без него и без --replace); 6: агент не появился или вышел сразу, его процесс
// погашен; 2: ошибка вызова; 1: hc или herdr-app ответил ошибкой.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Обёртка: агент внутри оболочки. После его выхода пространство остаётся с оболочкой,
// а выход программы, запущенной напрямую, закрыл бы панель и пространство. Имя программы в $0.
export const WRAP = '"$0" "$@"; exec "$SHELL" -l'

// Агенты сессий задач. Всё, что отличает одного агента от другого, живёт здесь.
export const AGENTS = {
  claude: {
    command: ['claude'],
    // argv[0] процесса. У Claude, запущенного напрямую, имя процесса равно номеру версии, поэтому argv.
    program: /(^|\/)claude$/,
    // status.app из отчёта OSC 7501.
    apps: ['claude-code'],
    newSession: () => randomUUID(),
    session: UUID,
    start: (id) => ['--session-id', id],
    resume: (id) => ['--resume', id],
    prompt: (skill, args) => `/${skill} ${args}`,
    trust: /trust this folder/i,
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

// Процесс агента в дереве терминала: от его корня (`pid` в `hc get`, обёртка) вниз по родителям.
// Не группа переднего плана: после Ctrl+Z агент из неё уходит, а сессия жива.
export function agentProcess(t, procs = []) {
  const root = t?.pid ?? t?.foreground?.pid
  if (!root) return null
  const children = new Map()
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])
  const queue = procs.filter((p) => p.pid === root)
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]
    const kind = kindOf(p.argv0)
    if (kind && !SERVER.test(p.args)) return { pid: p.pid, kind, stopped: p.stat.includes('T') }
    queue.push(...(children.get(p.pid) ?? []))
  }
  return null
}

// Агент в терминале: его статус, его программа впереди или его процесс в дереве терминала.
// Статус агента Herdr отдаёт только после вопроса о доверии папке, поэтому процесс решает наравне.
export const isAgent = (t, procs = []) =>
  Object.values(AGENTS).some((a) => a.apps.includes(t?.status?.app)) ||
  kindOf(t?.foreground?.argv?.[0]) !== null ||
  agentProcess(t, procs) !== null

// Папка внутри worktree: в пути есть сегмент worktree.dir и что-то после него.
export const insideWorktree = (cwd, dirs) =>
  typeof cwd === 'string' && dirs.some((dir) => cwd.includes(`/${dir}/`))

// Живая сессия занимает место: агент в терминале fleet или в папке worktree любого проекта.
export const liveSessions = (terminals, dirs, procs) =>
  terminals.filter(
    (t) => isAgent(t, procs) && (t.labels?.['task-fleet'] === '1' || insideWorktree(t.foreground?.cwd, dirs)),
  )

// Вопрос о доверии папке на экране агента: отвечает на него человек.
export const asksTrust = (screen, kind = 'claude') => AGENTS[kind].trust.test(screen)

export function runArgs({ name, cwd, task, agent, session, resume, launch, ownSpace, parent, shell, agentArgs, taskArgs, estimateFirst }) {
  const a = AGENTS[agent]
  const labels = [
    'task-fleet=1',
    `task=${task}`,
    `agent=${agent}`,
    ...(session ? [`agent-session=${session}`] : []),
    // По ней терминал находится сразу после запуска, даже если ID сессии агент выдаёт сам.
    `fleet-launch=${launch}`,
    // Незнакомый id Herdr заводит новым пространством с именем папки worktree.
    `herdr.space=fleet-${name}`,
    `herdr.tab=fleet-${name}-tab`,
    // По этим двум сайдбар ставит пространство задачи деревом под пространство оркестратора.
    ...(ownSpace ? [`task-fleet.space=${ownSpace}`] : []),
    `task-fleet.parent=${parent}`,
  ]
  return [
    'run', '--bg', '--no-parent', '--keep', '--name', name, '--cwd', cwd,
    ...labels.flatMap((label) => ['--label', label]),
    '--', shell, '-lc', WRAP, ...a.command,
    ...(session ? (resume ? a.resume(session) : a.start(session)) : []),
    ...agentArgs,
    ...(taskArgs ? [a.prompt(estimateFirst ? 'task-estimate' : 'task-run', taskArgs)] : []),
  ]
}

export function options(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      cwd: { type: 'string' },
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
  if (!/^[a-z0-9_-]{1,32}$/.test(name ?? '')) throw new Error('--name: до 32 знаков [a-z0-9_-]')
  if (!cwd || !isAbsolute(cwd)) throw new Error('--cwd: абсолютный путь к worktree')
  if (!/^[A-Za-z0-9._-]+$/.test(task ?? '')) throw new Error('--task: ID задачи или read-<имя>')
  if (!Object.hasOwn(AGENTS, agent)) throw new Error(`--agent: один из ${Object.keys(AGENTS).join(', ')}`)
  const a = AGENTS[agent]
  // Новой сессии ID выдаёт скрипт: uuidgen хук lean-ctx не пропускает. Перезапуск берёт прежний.
  if (values.resume && !values.session) throw new Error('--resume: нужен --session прежней сессии')
  const session = values.session ?? a.newSession?.() ?? null
  if (session !== null && !a.session.test(session)) throw new Error(`--session: не ID сессии ${agent}`)
  const taskArgs = values['task-args'] ?? null
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
    name, cwd, task, agent, session, taskArgs, estimateFirst: values['estimate-first'], resume: values.resume, replace: values.replace,
    limit, timeout, budget, launch: randomUUID(), agentArgs: positionals,
  }
}

// Гасит агента: TERM, затем CONT, иначе остановленный по Ctrl+Z процесс TERM не получит до продолжения.
// Оболочка обёртки остаётся, пространство с ней тоже.
export function stopAgent(proc, kill = process.kill) {
  for (const signal of ['SIGTERM', 'SIGCONT']) {
    try {
      kill(proc.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}

const hc = (args) => JSON.parse(execFileSync('hc', args, { encoding: 'utf8' }))
export const list = (label) => hc(['ls', ...(label ? ['--label', label] : []), '--json']).terminals ?? []
export const get = (address) => ({ address, ...hc(['get', address, '--json']) })

// Активное пространство окна; окно закрыто или не ответило: null, возвращать некуда.
function activeSpace() {
  try {
    const status = JSON.parse(execFileSync('herdr-app', ['status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    return status.space ?? null
  } catch {
    return null
  }
}

function worktreeDirs() {
  const root = join(homedir(), '.local/state/task-run')
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

async function launch(opts, parent) {
  // Весь запуск укладывается в бюджет: команду оркестратора инструмент убивает на 120 с.
  const deadline = Date.now() + opts.budget * 1000
  const left = (seconds) => Math.max(0, Math.min(seconds, (deadline - Date.now()) / 1000))

  for (const { address } of list(`task=${opts.task}`)) {
    const t = get(address)
    const alive = isAgent(t, readProcs())
    if (alive || !opts.replace) {
      throw new Exit(5, { status: 'exists', address, alive, agent: t.labels?.agent ?? null, space: t.labels?.['herdr.space'] ?? null })
    }
    // Перезапуск: в терминале осталась оболочка. Набрать в ней команду нельзя, `hc send` из терминала
    // агента приходит в обёртке `<hc from=…>`. Терминал закрывается, пространство с тем же id
    // откроется заново.
    execFileSync('hc', ['kill', address], { stdio: 'ignore' })
    if (!(await poll(() => !list(`task=${opts.task}`).some((other) => other.address === address), left(10)))) {
      throw new Exit(1, { status: 'error', message: `hc kill ${address} не закрыл терминал` })
    }
  }

  const live = liveSessions(list(null).map((t) => get(t.address)), worktreeDirs(), readProcs())
  if (live.length >= opts.limit) {
    throw new Exit(4, {
      status: 'full',
      limit: opts.limit,
      live: live.map((t) => ({ address: t.address, task: t.labels?.task ?? null, cwd: t.foreground?.cwd ?? null })),
    })
  }

  const ownSpace = get(parent).labels?.['herdr.space'] ?? null
  execFileSync('hc', runArgs({ ...opts, ownSpace, parent, shell: process.env.SHELL || '/bin/zsh' }), {
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  const address = await poll(() => list(`fleet-launch=${opts.launch}`)[0]?.address, left(10))
  if (!address) throw new Exit(1, { status: 'error', message: `hc run прошёл, но терминала с меткой fleet-launch=${opts.launch} нет` })
  const base = { address, agent: opts.agent, session: opts.session, launch: opts.launch, space: `fleet-${opts.name}` }

  // Агент появился, или обёртка уже отдала терминал оболочке (команды нет, агент упал на старте):
  // тогда ждать нечего.
  const started = await poll(() => {
    const t = get(address)
    if (isAgent(t, readProcs())) return 'agent'
    // Пустой foreground бывает в первые мгновения после запуска, по нему ничего не решаем.
    if (t.state === 'finished' || (t.foreground && !t.foreground.argv?.includes(WRAP))) return 'gone'
    return null
  }, left(opts.timeout))
  if (started !== 'agent') {
    const proc = agentProcess(get(address), readProcs())
    if (proc) stopAgent(proc)
    throw new Exit(6, { status: 'no-agent', ...base, reason: started === 'gone' ? 'exited' : 'timeout' })
  }

  // Агент запущен, но мог встать на вопросе о доверии папке: статуса агента тогда нет.
  // Экран рисуется не сразу, поэтому ждём либо статус, либо вопрос.
  const screen = await poll(() => {
    if (AGENTS[opts.agent].apps.includes(get(address).status?.app)) return 'ready'
    return asksTrust(execFileSync('hc', ['read', address, '--lines', '0'], { encoding: 'utf8' }), opts.agent) ? 'trust' : null
  }, left(15))
  return { status: 'started', ...base, trust: screen === 'trust' }
}

async function main() {
  let opts
  try {
    opts = options(process.argv.slice(2))
    if (!statSync(opts.cwd).isDirectory()) throw new Error(`--cwd: ${opts.cwd} не папка`)
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  const parent = process.env.HC_TERMINAL_ID
  if (!parent) {
    console.error('нет HC_TERMINAL_ID: оркестратор не в терминале Herdr')
    process.exit(2)
  }

  const userSpace = activeSpace()
  let code = 0
  let result
  try {
    result = await launch(opts, parent)
  } catch (error) {
    if (!(error instanceof Exit)) throw error
    ;({ code, result } = error)
  } finally {
    // Запуск не уводит окно с пространства пользователя, даже если упал на середине.
    const now = activeSpace()
    if (userSpace && now && now !== userSpace) {
      execFileSync('herdr-app', ['do', 'space.select', '--id', userSpace], { stdio: 'ignore' })
      if (result) result.restored = true
    }
  }
  if (code === 1) console.error(result.message)
  console.log(JSON.stringify(result))
  process.exit(code)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) {
  main().catch((error) => {
    console.error(error.stderr?.toString().trim() || error.message)
    process.exit(1)
  })
}
