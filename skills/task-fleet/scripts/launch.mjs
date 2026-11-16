#!/usr/bin/env node
// Запускает сессию задачи fleet в своём пространстве Herdr: проверяет дубль, считает места,
// делает `hc run` и ждёт, пока в терминале появится Claude. Звать под локом мест:
//
//   flock -w 20 -E 75 ~/.local/state/task-run/fleet.lock node launch.mjs \
//     --name <имя> --cwd <worktree> --task <ID> [--session <uuid> [--resume]] [--replace] \
//     [--limit 3] [--timeout 60] -- [аргументы claude после --session-id или --resume]
//
// --replace: терминал задачи, из которого Claude вышел, закрывается и запускается заново.
// Скрипт держит лок, пока ждёт Claude: иначе второй оркестратор не посчитает новую сессию.
// Обёртка с оболочкой собирается здесь, а не в команде агента: встроенный код `sh -c` хук lean-ctx
// не пропускает.
// Вывод: JSON одной строкой. Код выхода 0: запущена; 4: мест нет; 5: у задачи уже есть терминал
// (с Claude, или без него и без --replace);
// 6: Claude не появился за --timeout; 2: ошибка вызова; 1: hc или herdr-app ответил ошибкой.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const CLAUDE = /(^|\/)claude$/

// Процессы машины: группа и программа из argv.
export function readProcs() {
  const out = execFileSync('ps', ['-A', '-o', 'pgid=,args='], { encoding: 'utf8' })
  return out.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\S+)/)
    return match ? [{ pgid: Number(match[1]), program: match[2] }] : []
  })
}

// Под обёрткой впереди оболочка, а Claude её дочерний процесс в той же группе. Статус агента Herdr
// отдаёт только после вопроса о доверии папке, поэтому решает процесс в группе переднего плана.
// Claude, запущенный напрямую, виден и по argv: имя процесса у него равно номеру версии.
export const isClaude = (t, procs = []) =>
  t?.status?.app === 'claude-code' ||
  CLAUDE.test(t?.foreground?.argv?.[0] ?? '') ||
  procs.some((p) => p.pgid === t?.foreground?.pid && CLAUDE.test(p.program))

// Папка внутри worktree: в пути есть сегмент worktree.dir и что-то после него.
export const insideWorktree = (cwd, dirs) =>
  typeof cwd === 'string' && dirs.some((dir) => cwd.includes(`/${dir}/`))

// Живая сессия занимает место: Claude в терминале fleet или в папке worktree любого проекта.
export const liveSessions = (terminals, dirs, procs) =>
  terminals.filter(
    (t) => isClaude(t, procs) && (t.labels?.['task-fleet'] === '1' || insideWorktree(t.foreground?.cwd, dirs)),
  )

// Вопрос о доверии папке на экране Claude: отвечает на него человек.
export const asksTrust = (screen) => /trust this folder/i.test(screen)

export function runArgs({ name, cwd, task, session, resume, ownSpace, parent, shell, claudeArgs }) {
  const labels = [
    'task-fleet=1',
    `task=${task}`,
    `claude-session=${session}`,
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
    // Claude внутри оболочки: после его выхода пространство остаётся с оболочкой,
    // а выход программы, запущенной напрямую, закрыл бы панель и пространство.
    '--', shell, '-lc', 'claude "$@"; exec "$SHELL" -l', 'claude',
    ...(resume ? ['--resume', session] : ['--session-id', session]),
    ...claudeArgs,
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
      session: { type: 'string' },
      resume: { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
      limit: { type: 'string', default: '3' },
      timeout: { type: 'string', default: '60' },
    },
  })
  const { name, cwd, task } = values
  if (!/^[a-z0-9_-]{1,32}$/.test(name ?? '')) throw new Error('--name: до 32 знаков [a-z0-9_-]')
  if (!cwd || !isAbsolute(cwd)) throw new Error('--cwd: абсолютный путь к worktree')
  if (!/^[A-Za-z0-9._-]+$/.test(task ?? '')) throw new Error('--task: ID задачи или read-<имя>')
  // Новой сессии ID выдаёт скрипт: uuidgen хук lean-ctx не пропускает. Перезапуск берёт прежний.
  if (values.resume && !values.session) throw new Error('--resume: нужен --session прежней сессии')
  const session = values.session ?? randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session)) {
    throw new Error('--session: UUID в нижнем регистре')
  }
  const limit = Number(values.limit)
  const timeout = Number(values.timeout)
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit: целое больше нуля')
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('--timeout: секунды больше нуля')
  return { name, cwd, task, session, resume: values.resume, replace: values.replace, limit, timeout, claudeArgs: positionals }
}

const hc = (args) => JSON.parse(execFileSync('hc', args, { encoding: 'utf8' }))
const list = (label) => hc(['ls', ...(label ? ['--label', label] : []), '--json']).terminals ?? []
const get = (address) => ({ address, ...hc(['get', address, '--json']) })

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

async function poll(fn, seconds) {
  const end = Date.now() + seconds * 1000
  for (;;) {
    const value = fn()
    if (value) return value
    if (Date.now() >= end) return null
    await sleep(500)
  }
}

function done(code, result) {
  console.log(JSON.stringify(result))
  process.exit(code)
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

  for (const { address } of list(`task=${opts.task}`)) {
    const t = get(address)
    const claude = isClaude(t, readProcs())
    if (claude || !opts.replace) {
      done(5, { status: 'exists', address, claude, space: t.labels?.['herdr.space'] ?? null })
    }
    // Перезапуск: в терминале осталась оболочка. Набрать в ней команду нельзя, `hc send` из терминала
    // агента приходит в обёртке `<hc from=…>`. Терминал закрывается, пространство с тем же id
    // откроется заново.
    execFileSync('hc', ['kill', address], { stdio: 'ignore' })
    if (!(await poll(() => !list(`task=${opts.task}`).some((other) => other.address === address), 10))) {
      console.error(`hc kill ${address} не закрыл терминал`)
      process.exit(1)
    }
  }

  const live = liveSessions(list(null).map((t) => get(t.address)), worktreeDirs(), readProcs())
  if (live.length >= opts.limit) {
    done(4, {
      status: 'full',
      limit: opts.limit,
      live: live.map((t) => ({ address: t.address, task: t.labels?.task ?? null, cwd: t.foreground?.cwd ?? null })),
    })
  }

  const userSpace = activeSpace()
  const ownSpace = get(parent).labels?.['herdr.space'] ?? null
  execFileSync('hc', runArgs({ ...opts, ownSpace, parent, shell: process.env.SHELL || '/bin/zsh' }), {
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  const address = await poll(() => list(`claude-session=${opts.session}`)[0]?.address, 10)
  if (!address) {
    console.error(`hc run прошёл, но терминала с меткой claude-session=${opts.session} нет`)
    process.exit(1)
  }
  const started = await poll(() => isClaude(get(address), readProcs()), opts.timeout)

  // Claude запущен, но мог встать на вопросе о доверии папке: статуса агента тогда нет.
  // Экран рисуется не сразу, поэтому ждём либо статус, либо вопрос.
  const screen = started
    ? await poll(() => {
        if (get(address).status?.app === 'claude-code') return 'ready'
        return asksTrust(execFileSync('hc', ['read', address, '--lines', '0'], { encoding: 'utf8' })) ? 'trust' : null
      }, 15)
    : null

  // Запуск не уводит окно с пространства пользователя.
  const now = activeSpace()
  const restored = Boolean(userSpace && now && now !== userSpace)
  if (restored) execFileSync('herdr-app', ['do', 'space.select', '--id', userSpace], { stdio: 'ignore' })

  done(started ? 0 : 6, {
    status: started ? 'started' : 'no-claude',
    address,
    session: opts.session,
    space: `fleet-${opts.name}`,
    trust: screen === 'trust',
    restored,
  })
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) {
  main().catch((error) => {
    console.error(error.stderr?.toString().trim() || error.message)
    process.exit(1)
  })
}
