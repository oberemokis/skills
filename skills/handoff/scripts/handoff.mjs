#!/usr/bin/env node
// Передача работы между агентами и сессиями. Файл передачи лежит в .handoff/HANDOFF.md корня рабочей копии:
// у каждого worktree своя передача, а .handoff/.gitignore со звёздочкой прячет папку от git без правки .git
// (песочница Codex держит .git только на чтение).
// Команды: prepare, check, status, close, hook. Коды выхода: 0 порядок, 1 передача не заполнена,
// 2 ошибка вызова, 3 передачи нет.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const DIR = '.handoff'
export const FILE = 'HANDOFF.md'
const HISTORY = 'history'
const SNAPSHOT = 'Снимок репозитория'
const SNAPSHOT_MARK = '<!-- снимок пишет скрипт, не правь -->'
const STATUS_LIMIT = 40

export const SECTIONS = [
  ['Задача', 'что делаем и зачем, критерий готовности, ссылка на задачу'],
  ['Сделано', 'что готово и чем это проверено: команда, тест, ручная проверка'],
  ['В процессе', 'что начато и не доведено, в каком состоянии файлы'],
  ['Решения', 'решение и причина; отдельно то, что утвердил пользователь'],
  ['Тупики', 'что пробовали и почему не сработало, чтобы принимающий не пробовал снова'],
  ['Следующий шаг', 'первое конкретное действие: файл, команда или вопрос пользователю'],
  ['Открытые вопросы', 'что ждёт ответа пользователя'],
  ['Как проверить', 'команды, которыми принимающий убедится, что состояние такое, как описано'],
]

// Список `git rev-parse --local-env-vars`. Git-хуки выставляют их вызывающему процессу, и тогда -C не спасает:
// команда идёт в репозиторий из GIT_DIR, а не в папку передачи.
export const GIT_LOCAL_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY',
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
]

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_LOCAL_ENV.includes(key)))

function git(cwd, args) {
  try {
    // trimEnd, а не trim: строка porcelain начинается с пробела, если файл не в индексе
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv, stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd()
  } catch {
    return null
  }
}

const lines = (text) => (text ? text.split('\n').filter(Boolean) : [])

export function resolveRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']) ?? resolve(cwd)
}

export function snapshot(root) {
  if (git(root, ['rev-parse', '--git-dir']) === null) return { git: false }

  const head = git(root, ['rev-parse', 'HEAD'])
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  const counts = upstream ? git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']) : null
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [null, null]

  return {
    git: true,
    branch: git(root, ['branch', '--show-current']) || '(detached)',
    head,
    upstream,
    ahead,
    behind,
    status: lines(git(root, ['status', '--porcelain=v1', '--untracked-files=all'])),
    log: head ? lines(git(root, ['log', '-5', '--format=%h %s'])) : [],
    stashes: lines(git(root, ['stash', 'list'])).length,
  }
}

export function renderSnapshot(snap) {
  if (!snap.git) return 'Папка не в репозитории git.'

  const out = [`Ветка \`${snap.branch}\`, HEAD \`${snap.head ? snap.head.slice(0, 12) : 'коммитов нет'}\`.`]

  if (snap.upstream) out.push(`Upstream \`${snap.upstream}\`: впереди на ${snap.ahead}, позади на ${snap.behind}.`)
  else out.push('Upstream не задан, ветка не запушена.')

  if (snap.stashes > 0) out.push(`В stash записей: ${snap.stashes}.`)

  if (snap.status.length === 0) {
    out.push('', 'Рабочая копия чистая.')
  } else {
    const shown = snap.status.slice(0, STATUS_LIMIT)
    out.push('', 'Незакоммичено:', '', '```', ...shown)
    if (snap.status.length > shown.length) out.push(`... и ещё ${snap.status.length - shown.length}`)
    out.push('```')
  }

  if (snap.log.length > 0) out.push('', 'Последние коммиты:', '', '```', ...snap.log, '```')

  return out.join('\n')
}

export function renderTemplate({ agent, created, root, snap }) {
  const front = ['---', `agent: ${agent}`, `created: ${created}`, `root: ${root}`]
  if (snap.git) front.push(`branch: ${snap.branch}`, `head: ${snap.head ?? ''}`)
  front.push('---')

  const body = SECTIONS.flatMap(([title, hint]) => [`## ${title}`, '', `<!-- ${hint} -->`, ''])

  return [...front, '', '# Передача', '', ...body, `## ${SNAPSHOT}`, '', SNAPSHOT_MARK, '', renderSnapshot(snap), ''].join('\n')
}

export function parseHandoff(text) {
  const meta = {}
  let rest = text

  const front = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (front) {
    for (const line of front[1].split('\n')) {
      const pair = line.match(/^([\w-]+):\s*(.*)$/)
      if (pair) meta[pair[1]] = pair[2].trim()
    }
    rest = text.slice(front[0].length)
  }

  const sections = new Map()
  let current = null
  for (const line of rest.split('\n')) {
    const heading = line.match(/^## (.+?)\s*$/)
    if (heading) {
      current = heading[1]
      sections.set(current, [])
    } else if (current) {
      sections.get(current).push(line)
    }
  }

  return { hasFront: Boolean(front), meta, sections: new Map([...sections].map(([key, value]) => [key, value.join('\n')])) }
}

// подсказки в заготовке стоят HTML-комментариями: раздел, где остались только они, считается пустым
const contentOf = (body) => body.replace(/<!--[\s\S]*?-->/g, '').trim()

export function checkHandoff(text) {
  const { hasFront, meta, sections } = parseHandoff(text)
  const problems = []

  if (!hasFront) problems.push('нет фронтматтера: заготовку пишет команда prepare, его не удаляй')
  else if (!meta.agent) problems.push('поле agent пустое: кто передаёт работу')

  for (const [title] of SECTIONS) {
    if (!sections.has(title)) problems.push(`нет раздела «${title}»`)
    else if (contentOf(sections.get(title)) === '') problems.push(`раздел «${title}» пуст: если сказать нечего, напиши «нет»`)
  }

  return problems
}

function filledSections(text) {
  const { sections } = parseHandoff(text)
  return SECTIONS.filter(([title]) => contentOf(sections.get(title) ?? '') !== '').length
}

const stamp = (iso) => iso.replace(/:/g, '-')
const isoNow = (now) => now.toISOString().replace(/\.\d+Z$/, 'Z')

function archive(root, text) {
  const { meta } = parseHandoff(text)
  const dir = join(root, DIR, HISTORY)
  mkdirSync(dir, { recursive: true })

  const base = stamp(meta.created || isoNow(new Date()))
  let target = join(dir, `${base}.md`)
  for (let n = 2; existsSync(target); n++) target = join(dir, `${base}-${n}.md`)

  renameSync(join(root, DIR, FILE), target)
  return target
}

export function prepare(root, { agent = '', now = new Date() } = {}) {
  const dir = join(root, DIR)
  mkdirSync(dir, { recursive: true })

  const ignore = join(dir, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '# передачи локальные, в git не идут\n*\n')

  const path = join(dir, FILE)
  let archived = null
  // пустую заготовку прошлой попытки перезаписываем, а всё, где есть хоть один заполненный раздел, бережём
  if (existsSync(path) && filledSections(readFileSync(path, 'utf8')) > 0) archived = archive(root, readFileSync(path, 'utf8'))

  writeFileSync(path, renderTemplate({ agent, created: isoNow(now), root, snap: snapshot(root) }))
  return { path, archived }
}

export function close(root) {
  const path = join(root, DIR, FILE)
  if (!existsSync(path)) return null
  return archive(root, readFileSync(path, 'utf8'))
}

export function readStatus(root, now = new Date()) {
  const path = join(root, DIR, FILE)
  if (!existsSync(path)) return { state: 'missing', path }

  const text = readFileSync(path, 'utf8')
  const { meta } = parseHandoff(text)
  const problems = checkHandoff(text)
  const current = snapshot(root)
  const created = Date.parse(meta.created)

  const drift = { branchChanged: false, headChanged: false, headUnknown: false, rewritten: false, commits: [] }
  if (current.git && meta.branch) drift.branchChanged = meta.branch !== current.branch
  if (current.git && meta.head && current.head && meta.head !== current.head) {
    drift.headChanged = true
    if (git(root, ['cat-file', '-e', `${meta.head}^{commit}`]) === null) {
      drift.headUnknown = true
    } else {
      // --is-ancestor отвечает только кодом выхода: ошибка значит, что историю переписали (rebase, reset, amend)
      drift.rewritten = git(root, ['merge-base', '--is-ancestor', meta.head, 'HEAD']) === null
      drift.commits = lines(git(root, ['log', '--format=%h %s', `${meta.head}..HEAD`]))
    }
  }

  return {
    state: problems.length > 0 ? 'unfilled' : 'ready',
    path,
    meta,
    problems,
    ageMs: Number.isNaN(created) ? null : now.getTime() - created,
    current,
    drift,
  }
}

export function formatAge(ms) {
  if (ms === null) return 'время неизвестно'
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} ч назад`
  return `${Math.round(hours / 24)} дн назад`
}

export function formatStatus(status) {
  if (status.state === 'missing') return `Передачи нет: ${status.path}`

  const { meta, drift, current } = status
  const out = [`Передача: ${status.path}`, `От: ${meta.agent || 'агент не указан'}, ${meta.created || '?'} (${formatAge(status.ageMs)})`]

  if (status.state === 'unfilled') {
    out.push('Заготовка не заполнена, передающая сессия оборвалась на записи. Пропуски:', ...status.problems.map((p) => `- ${p}`))
  }

  if (!current.git) return out.join('\n')

  if (drift.branchChanged) out.push(`Ветка сменилась: была ${meta.branch}, сейчас ${current.branch}.`)
  if (drift.headUnknown) out.push(`Коммита ${meta.head.slice(0, 12)} из передачи в репозитории нет: снимок устарел.`)
  else if (drift.rewritten) out.push(`История переписана после передачи: ${meta.head.slice(0, 12)} больше не предок HEAD.`)
  if (drift.commits.length > 0) out.push('Коммиты после передачи:', ...drift.commits.map((c) => `- ${c}`))
  if (!drift.headChanged && !drift.branchChanged) out.push('HEAD и ветка те же, что в передаче.')

  out.push(current.status.length === 0 ? 'Рабочая копия сейчас чистая.' : `Незакоммичено сейчас файлов: ${current.status.length}.`)
  return out.join('\n')
}

export function hookContext(cwd, now = new Date()) {
  const status = readStatus(resolveRoot(cwd), now)
  if (status.state === 'missing') return null

  return [
    'В рабочей копии лежит передача работы от другого агента или сессии.',
    formatStatus(status),
    'Если пользователь начал с другой задачи, скажи ему о передаче одной строкой и спроси, подхватить ли её. ' +
      'Подхватываешь, прочитай скилл handoff и иди по его разделу «Принять».',
  ].join('\n\n')
}

const USAGE = `Использование: handoff.mjs <команда> [--dir <папка>] [--agent <имя>]

  prepare  заготовка .handoff/HANDOFF.md со снимком репозитория; заполненная прежняя передача уходит в history
  check    проверка заполнения; код 1, если есть пропуски
  status   сводка для принимающего: кто, когда, что изменилось с тех пор; код 3, если передачи нет
  close    убрать передачу в history, когда работа по ней принята или закончена
  hook     хук SessionStart Claude Code: JSON события в stdin, дополнительный контекст в stdout`

function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const match = rest[i].match(/^--(dir|agent)$/)
    if (!match || rest[i + 1] === undefined) return { command, error: `непонятный аргумент ${rest[i]}` }
    flags[match[1]] = rest[++i]
  }
  return { command, flags }
}

function readHookInput() {
  if (process.stdin.isTTY) return {}
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function main() {
  const { command, flags, error } = parseArgs(process.argv.slice(2))
  const commands = ['prepare', 'check', 'status', 'close', 'hook']

  if (!commands.includes(command) || error) {
    console.log(error ? `${error}\n\n${USAGE}` : USAGE)
    process.exit(2)
  }

  if (command === 'hook') {
    // хук не должен ронять старт сессии: любая ошибка значит «контекста нет»
    try {
      const input = readHookInput()
      const context = hookContext(input.cwd ?? process.cwd())
      if (context) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }))
    } catch {}
    return
  }

  const root = resolveRoot(flags.dir ?? process.cwd())

  if (command === 'prepare') {
    const agent = flags.agent ?? (process.env.CLAUDECODE ? 'claude-code' : '')
    const { path, archived } = prepare(root, { agent })
    if (archived) console.log(`Прежняя передача перенесена: ${archived}`)
    console.log(`Заготовка: ${path}`)
    if (!agent) console.log('Поле agent пустое: впиши, кто передаёт, или запусти с --agent <имя>.')
    console.log('Заполни разделы, затем запусти check.')
    return
  }

  if (command === 'check') {
    const path = join(root, DIR, FILE)
    if (!existsSync(path)) {
      console.log(`Передачи нет: ${path}`)
      process.exit(3)
    }
    const problems = checkHandoff(readFileSync(path, 'utf8'))
    if (problems.length === 0) {
      console.log(`Передача заполнена: ${path}`)
      return
    }
    console.log([`Передача не заполнена: ${path}`, ...problems.map((p) => `- ${p}`)].join('\n'))
    process.exit(1)
  }

  if (command === 'status') {
    const status = readStatus(root)
    console.log(formatStatus(status))
    if (status.state === 'missing') process.exit(3)
    if (status.state === 'unfilled') process.exit(1)
    return
  }

  const archived = close(root)
  if (!archived) {
    console.log(`Передачи нет: ${join(root, DIR, FILE)}`)
    process.exit(3)
  }
  console.log(`Передача закрыта и перенесена: ${archived}`)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) main()
