#!/usr/bin/env node
// Снимок страницы стенда с красной рамкой вокруг изменённых элементов, для визуального ревью:
//
//   node shots.mjs --from <папка с playwright> --out <папка снимков> --url <адрес> --name <имя> \
//     --mark "<селектор>" [--mark "<селектор>"] [--width 1440]
//
// Playwright берётся из проекта задачи, от папки `--from`: у репозитория скиллов зависимостей нет.
// Браузер свой, без входа пользователя. Селекторы в синтаксисе Playwright: CSS, `text=`, `role=`.
// Пишет `<имя>.png` (страница целиком) и `<имя>-zoom.png` (область рамок с полями), печатает JSON:
// { url, shots, marked, missing }.
// Коды: 0 снято; 2 ошибка вызова; 3 нет Playwright; 4 браузер или страница не открылись;
// 5 снято, но часть селекторов ничего не нашла.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FRAME = { color: '#ff2d2d', width: 3, gap: 4 }
const PAD = 48
const WAIT = 10_000
const USAGE =
  'shots.mjs --from <папка с playwright> --out <папка снимков> --url <адрес> --name <имя> --mark "<селектор>" [--mark ...] [--width 1440]'

// Разбор аргументов: null, если вызов неполный или кривой.
export function parseArgs(argv) {
  const args = { marks: [], width: 1440 }
  for (let i = 0; i < argv.length; i += 2) {
    const [key, value] = [argv[i], argv[i + 1]]
    if (value === undefined) return null
    if (key === '--mark') args.marks.push(value)
    else if (key === '--width') args.width = /^\d+$/.test(value) ? Number(value) : NaN
    else if (['--from', '--out', '--url', '--name'].includes(key)) args[key.slice(2)] = value
    else return null
  }
  const ok =
    args.from && args.out && /^https?:\/\//.test(args.url ?? '') && /^[\w.-]+$/.test(args.name ?? '') && args.marks.length && args.width > 0
  return ok ? args : null
}

// Область крупного снимка: все рамки с полями, обрезанная по странице. null, если рамок нет.
export function unionClip(boxes, page, pad = PAD) {
  if (!boxes.length) return null
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const right = Math.min(page.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
  const bottom = Math.min(page.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

// Модуль с `chromium` из проекта: `playwright`, `@playwright/test` или `playwright-core`. null, если нет ни одного.
export async function loadPlaywright(from) {
  const require = createRequire(join(resolve(from), 'shots.cjs'))
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    let path
    try {
      path = require.resolve(name)
    } catch {
      continue
    }
    const mod = await import(pathToFileURL(path).href)
    const chromium = mod.chromium ?? mod.default?.chromium
    if (chromium) return { name, chromium }
  }
  return null
}

// Свой Chromium Playwright, а если его не скачивали, установленный Chrome.
async function launch(chromium) {
  try {
    return await chromium.launch()
  } catch (first) {
    try {
      return await chromium.launch({ channel: 'chrome' })
    } catch {
      throw first
    }
  }
}

// Прямоугольники видимых совпадений селектора в координатах документа.
async function boxesOf(page, selector) {
  const locator = page.locator(selector)
  try {
    await locator.first().waitFor({ state: 'visible', timeout: WAIT })
  } catch {
    return []
  }
  return locator.evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height })),
  )
}

// Рамки рисуются поверх страницы отдельным слоем: разметку и стили страницы они не трогают.
// Рамка обрезается по документу, иначе рамка элемента во всю ширину расширяет страницу.
function drawFrames({ boxes, frame }) {
  const doc = document.documentElement
  const [maxX, maxY] = [doc.scrollWidth, doc.scrollHeight]
  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none'
  for (const b of boxes) {
    const off = frame.gap + frame.width
    const [x, y] = [Math.max(0, b.x - off), Math.max(0, b.y - off)]
    const [right, bottom] = [Math.min(maxX, b.x + b.width + off), Math.min(maxY, b.y + b.height + off)]
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;box-sizing:border-box;left:${x}px;top:${y}px;width:${right - x}px;height:${bottom - y}px;border:${frame.width}px solid ${frame.color}`
    layer.append(el)
  }
  doc.append(layer)
}

async function shoot(chromium, args) {
  mkdirSync(args.out, { recursive: true })
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: args.width, height: 900 } })
    const response = await page.goto(args.url, { waitUntil: 'load' })
    if (response && response.status() >= 400) throw new Error(`${args.url} ответил ${response.status()}`)
    await page.evaluate(() => document.fonts.ready.then(() => true))

    const found = await Promise.all(args.marks.map((selector) => boxesOf(page, selector)))
    const missing = args.marks.filter((_, i) => !found[i].length)
    const boxes = found.flat()
    const size = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))
    await page.evaluate(drawFrames, { boxes, frame: FRAME })

    const shots = [join(args.out, `${args.name}.png`)]
    await page.screenshot({ path: shots[0], fullPage: true, animations: 'disabled' })
    const margin = FRAME.gap + FRAME.width
    const framed = boxes.map((b) => ({ x: b.x - margin, y: b.y - margin, width: b.width + 2 * margin, height: b.height + 2 * margin }))
    const clip = unionClip(framed, size)
    if (clip) {
      shots.push(join(args.out, `${args.name}-zoom.png`))
      await page.screenshot({ path: shots[1], fullPage: true, clip, animations: 'disabled' })
    }
    return { url: page.url(), shots, marked: boxes.length, missing }
  } finally {
    await browser.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error(USAGE)
    process.exit(2)
  }
  const pw = await loadPlaywright(args.from)
  if (!pw) {
    console.error(`Playwright не найден от ${resolve(args.from)}: нет ни playwright, ни @playwright/test, ни playwright-core`)
    process.exit(3)
  }
  let result
  try {
    result = await shoot(pw.chromium, { ...args, out: resolve(args.out) })
  } catch (error) {
    console.error(`Снимок не снят: ${error.message.split('\n')[0]}`)
    process.exit(4)
  }
  console.log(JSON.stringify(result))
  process.exit(result.missing.length ? 5 : 0)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) main()
