#!/usr/bin/env node
// Проверки репозитория скиллов: ссылки, утечки, фронтматтер. Тесты скриптов запускает scripts/check.sh.
//
//   node scripts/check.mjs [корень]
//
// Код выхода 0: всё в порядке; 1: есть замечания, они напечатаны по одному на строку.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

const SKIP_DIRS = new Set(['.git', '.worktrees', 'node_modules', 'drafts'])
const TEXT = /\.(md|mjs|js|sh|json|ya?ml|toml)$/

// Репозиторий публичный. Данные проекта (ID задач, люди, внутренние хосты, личные пути) живут у пользователя,
// а не здесь. Точного списка запрещённого нет нарочно: он сам опубликовал бы то, что прячем, поэтому проверка
// идёт по формам. Примеры пишутся с PROJ-123, хостами example.org, host.org, mirror.org и путём /Users/me.
const ID_PREFIXES = new Set(['PROJ', 'UTF', 'ISO'])
const HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|ru|studio|dev|app|team|ai)\b/gi
// По форме внутренний хост от публичного не отличить, поэтому публичная ссылка добавляется сюда осознанно.
// status.app это поле JSON `hc get`, а не хост.
const PUBLIC_HOSTS = ['example.org', 'example.com', 'host.org', 'mirror.org', 'status.app', 'go.dev', 'wikipedia.org', 'github.com', 'agentskills.io']
const PERSONAL_PATH = /\/(?:Users|home)\/([a-z][a-z0-9_-]*)/g
const EXAMPLE_USERS = new Set(['me', 'user'])
const MENTION = /(^|[\s(«])@([A-Za-zА-Яа-яЁё][\w.А-Яа-яЁё-]*)(?!\/)/g

// Стандарт Agent Skills: имя 1–64 знака, a-z, 0-9 и дефис, не с дефиса, без двойного дефиса, равно папке.
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function walk(root, dir = '') {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(root, path)
    return TEXT.test(entry.name) ? [path] : []
  })
}

// Строки вне блоков кода ``` с их номерами.
function prose(text) {
  let fence = false
  return text.split('\n').flatMap((line, i) => {
    if (/^\s*```/.test(line)) {
      fence = !fence
      return []
    }
    return fence ? [] : [[i + 1, line]]
  })
}

// Простой разбор фронтматтера: ключи верхнего уровня и вложенные на один уровень (metadata).
export function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const out = {}
  let parent = null
  for (const line of match[1].split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue
    const top = line.match(/^([\w-]+):\s*(.*)$/)
    if (top) {
      parent = top[2] === '' ? top[1] : null
      out[top[1]] = top[2] === '' ? {} : top[2].replace(/^"(.*)"$/, '$1')
      continue
    }
    const nested = line.match(/^\s+([\w-]+):\s*(.*)$/)
    if (nested && parent && typeof out[parent] === 'object') out[parent][nested[1]] = nested[2].replace(/^"(.*)"$/, '$1')
  }
  return out
}

const skillOf = (file) => (file.startsWith('skills/') ? file.split('/').slice(0, 2).join('/') : null)

function checkLinks(root, files, problem) {
  let count = 0
  for (const file of files.filter((f) => f.endsWith('.md'))) {
    const here = dirname(file)
    const skill = skillOf(file)
    for (const [n, line] of prose(readFileSync(join(root, file), 'utf8'))) {
      for (const [, target] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^[a-z]+:|^#|^\/|</i.test(target)) continue
        count++
        const path = target.replace(/#.*$/, '')
        if (!existsSync(join(root, here, path))) problem(`${file}:${n}: битая ссылка ${target}`)
      }
      // Пути в обратных кавычках: так скиллы ссылаются на соседей, `<папка скилла>/../review/SKILL.md`.
      // В «<папка скилла>» есть пробел, поэтому токен берётся целиком, а пробел проверяется уже в остатке пути.
      for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
        const own = token.startsWith('<папка скилла>/')
        const rest = own ? token.slice('<папка скилла>/'.length) : token
        if (!own && !/^\.\.?\//.test(token)) continue
        if (/\s/.test(rest) || !/\.(md|mjs|json|sh)$/.test(rest) || rest.includes('<')) continue
        count++
        const bases = own ? [skill] : [here, skill]
        if (!bases.some((base) => base !== null && existsSync(join(root, base, rest)))) {
          problem(`${file}:${n}: битая ссылка ${token}`)
        }
      }
    }
  }
  return count
}

function checkLeaks(root, files, internal, problem) {
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8')
    // @-упоминания ищутся только там, где речь о людях и процессе: в коде знаниевых скиллов их полно (@click, @theme).
    const mentions = internal.has(skillOf(file)) || /^(agents|docs)\//.test(file) || file === 'README.md'
    text.split('\n').forEach((line, i) => {
      const at = `${file}:${i + 1}`
      for (const [id, prefix] of line.matchAll(/\b([A-Z]{2,})-\d+\b/g)) {
        if (!ID_PREFIXES.has(prefix)) problem(`${at}: ID задачи ${id} (в примерах PROJ-123)`)
      }
      for (const [host] of line.matchAll(HOST)) {
        const h = host.toLowerCase()
        if (!PUBLIC_HOSTS.some((ok) => h === ok || h.endsWith(`.${ok}`))) {
          problem(`${at}: хост ${host} (публичный добавь в PUBLIC_HOSTS в scripts/check.mjs)`)
        }
      }
      for (const [path, user] of line.matchAll(PERSONAL_PATH)) {
        if (!EXAMPLE_USERS.has(user)) problem(`${at}: личный путь ${path} (в примерах /Users/me)`)
      }
      if (mentions) {
        for (const [, , who] of line.replace(/`[^`]*`/g, '').matchAll(MENTION)) problem(`${at}: упоминание @${who}`)
      }
    })
  }
}

function checkSkills(root, problem) {
  const internal = new Set()
  if (!existsSync(join(root, 'skills'))) {
    problem('нет папки skills: проверять нечего, а проверка не должна проходить молча')
    return { internal, count: 0 }
  }
  let count = 0
  for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = `skills/${entry.name}`
    const file = `${dir}/SKILL.md`
    if (!existsSync(join(root, file))) {
      problem(`${dir}: нет SKILL.md, агенты папку не увидят`)
      continue
    }
    count++
    const fm = frontmatter(readFileSync(join(root, file), 'utf8'))
    if (!fm) {
      problem(`${file}: нет фронтматтера`)
      continue
    }
    if (fm.name !== entry.name) problem(`${file}: name «${fm.name}» не совпадает с папкой, Claude Code скилл не найдёт`)
    if (!NAME.test(fm.name ?? '') || fm.name.length > 64) problem(`${file}: name «${fm.name}» не по стандарту (a-z, 0-9, дефис, до 64)`)
    if (!fm.description || fm.description.length > 1024) problem(`${file}: description пуст или длиннее 1024 знаков`)
    const isInternal = fm.metadata?.internal === 'true'
    if (isInternal) internal.add(dir)
    // Ручной вызов: Claude Code и OpenCode читают disable-model-invocation, Codex только agents/openai.yaml.
    // Скилл только для Claude (internal) Codex не ставится, ему пара не нужна.
    const manual = fm['disable-model-invocation'] === 'true'
    const yaml = join(root, dir, 'agents/openai.yaml')
    const codexManual = existsSync(yaml) && /allow_implicit_invocation:\s*false/.test(readFileSync(yaml, 'utf8'))
    if (manual && !isInternal && !codexManual) problem(`${file}: disable-model-invocation без agents/openai.yaml, Codex будет вызывать скилл сам`)
    if (codexManual && !manual) problem(`${dir}/agents/openai.yaml: ручной вызов в Codex, а в SKILL.md нет disable-model-invocation`)
  }
  if (existsSync(join(root, 'agents'))) {
    for (const name of readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md'))) {
      const fm = frontmatter(readFileSync(join(root, 'agents', name), 'utf8'))
      if (fm?.name !== basename(name, '.md')) problem(`agents/${name}: name не совпадает с именем файла`)
      if (!fm?.description) problem(`agents/${name}: нет description`)
    }
  }
  return { internal, count }
}

export function check(root) {
  const problems = []
  const problem = (text) => problems.push(text)
  const { internal, count } = checkSkills(root, problem)
  const files = walk(root)
  const links = checkLinks(root, files, problem)
  checkLeaks(root, files, internal, problem)
  return { problems, skills: count, links, files: files.length }
}

if (import.meta.main) {
  const root = process.argv[2] ?? join(import.meta.dirname, '..')
  const { problems, skills, links, files } = check(root)
  for (const p of problems) console.error(p)
  if (problems.length) {
    console.error(`замечаний: ${problems.length}`)
    process.exit(1)
  }
  console.log(`в порядке: скиллов ${skills}, ссылок ${links}, файлов на утечки ${files} (${relative(process.cwd(), root) || '.'})`)
}
