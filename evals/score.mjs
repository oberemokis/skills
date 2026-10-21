// Считает, насколько находки ревью совпадают с посеянными дефектами.
//
// Без аргументов: проверяет, что строки эталона указывают на непустой код,
// и прогоняет эталон сам на себя (recall и precision должны быть 1).
// С аргументом: сравнивает файл находок с эталоном.
//
// Формат находки: { "file": "cart.test.ts", "line": 7, "item": 5, "level": 1 }
// file это имя файла внутри фикстуры, line совпадает с эталоном с допуском
// в две строки, item и level необязательны и нужны только для точности уровня.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const suites = ['test-review', 'correctness']
const TOLERANCE = 2

function loadExpected(suite) {
  return JSON.parse(readFileSync(join(here, suite, 'expected.json'), 'utf8'))
}

function sourceLine(suite, file, line) {
  const path = join(here, suite, 'fixture', file)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8').split('\n')[line - 1] ?? null
}

function score(expected, candidates) {
  const used = new Set()
  const matches = []
  for (const exp of expected) {
    const idx = candidates.findIndex(
      (cand, i) =>
        !used.has(i) &&
        cand.file === exp.file &&
        Math.abs(cand.line - exp.line) <= TOLERANCE,
    )
    if (idx !== -1) {
      used.add(idx)
      matches.push({ exp, cand: candidates[idx] })
    }
  }
  const falsePositives = candidates.filter((_, i) => !used.has(i))
  const misses = expected.filter((exp) => !matches.some((m) => m.exp === exp))
  const levelRight = matches.filter(
    (m) => m.cand.level === undefined || m.cand.level === m.exp.level,
  ).length
  return {
    recall: expected.length ? matches.length / expected.length : 0,
    precision: candidates.length ? matches.length / candidates.length : 0,
    levelAccuracy: matches.length ? levelRight / matches.length : 0,
    matches,
    misses,
    falsePositives,
  }
}

function printReport(label, result) {
  const pct = (x) => (x * 100).toFixed(0) + '%'
  console.log(`${label}`)
  console.log(`  recall ${pct(result.recall)}  precision ${pct(result.precision)}  уровень верен ${pct(result.levelAccuracy)}`)
  for (const m of result.matches) {
    console.log(`  найдено ${m.exp.id}: ${m.exp.file}:${m.cand.line}`)
  }
  for (const m of result.misses) {
    console.log(`  пропущено ${m.id}: ${m.file}:${m.line} (${m.what})`)
  }
  for (const fp of result.falsePositives) {
    console.log(`  лишнее: ${fp.file}:${fp.line}`)
  }
}

function selfCheck(suite) {
  const expected = loadExpected(suite)
  let ok = true
  for (const exp of expected) {
    const text = sourceLine(suite, exp.file, exp.line)
    if (text === null || text.trim() === '') {
      console.log(`строка эталона не найдена: ${exp.id} ${exp.file}:${exp.line}`)
      ok = false
    } else {
      console.log(`${exp.id} ${exp.file}:${exp.line}  ${text.trim()}`)
    }
  }
  const perfect = expected.map((e) => ({ file: e.file, line: e.line, item: e.item, level: e.level }))
  const result = score(expected, perfect)
  printReport(`эталон на себя, ${suite}`, result)
  if (result.recall !== 1 || result.precision !== 1) ok = false
  return ok
}

const arg = process.argv[2]

if (!arg) {
  const allOk = suites.map(selfCheck).every(Boolean)
  process.exit(allOk ? 0 : 1)
}

const suite = suites.find((s) => arg.includes(s)) ?? suites[0]
const candidates = JSON.parse(readFileSync(resolve(arg), 'utf8'))
const result = score(loadExpected(suite), candidates)
printReport(`${suite}: ${arg}`, result)
