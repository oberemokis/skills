import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadPlaywright, parseArgs, unionClip } from './shots.mjs'

const call = ['--from', '/p', '--out', '/s', '--url', 'http://localhost:3000/cart', '--name', 'cart']

test('вызов собирает все рамки и ширину, неполный или кривой вызов отклоняется', () => {
  assert.deepEqual(parseArgs([...call, '--mark', '.total', '--mark', 'role=button[name="Оплатить"]', '--width', '390']), {
    from: '/p',
    out: '/s',
    url: 'http://localhost:3000/cart',
    name: 'cart',
    marks: ['.total', 'role=button[name="Оплатить"]'],
    width: 390,
  })
  assert.equal(parseArgs([...call, '--mark', '.total']).width, 1440)

  assert.equal(parseArgs(call), null, 'без рамки снимок не про правку')
  assert.equal(parseArgs([...call, '--mark']), null)
  assert.equal(parseArgs([...call, '--mark', '.a', '--width', 'wide']), null)
  assert.equal(parseArgs([...call, '--mark', '.a', '--shot', 'x']), null)
  assert.equal(parseArgs(['--from', '/p', '--out', '/s', '--url', '/cart', '--name', 'cart', '--mark', '.a']), null, 'адрес без хоста')
  assert.equal(parseArgs(['--from', '/p', '--out', '/s', '--url', 'http://x', '--name', '../cart', '--mark', '.a']), null, 'имя с путём')
})

test('крупный снимок охватывает все рамки с полями и не выходит за страницу', () => {
  const page = { width: 1440, height: 3000 }
  assert.deepEqual(
    unionClip(
      [
        { x: 100, y: 200, width: 50, height: 20 },
        { x: 400, y: 900, width: 100, height: 40 },
      ],
      page,
      48,
    ),
    { x: 52, y: 152, width: 496, height: 836 },
  )
  // Элемент у края: поля обрезаются страницей.
  assert.deepEqual(unionClip([{ x: 10, y: 5, width: 1420, height: 30 }], page, 48), { x: 0, y: 0, width: 1440, height: 83 })
  assert.equal(unionClip([], page), null)
})

test('Playwright ищется от папки проекта, а не от папки скилла', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shots-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const app = join(dir, 'apps', 'web')
  mkdirSync(app, { recursive: true })

  assert.equal(await loadPlaywright(app), null)

  // Поднятый в корень монорепы пакет находится и из папки приложения.
  const pkg = join(dir, 'node_modules', '@playwright', 'test')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@playwright/test', main: 'index.js' }))
  writeFileSync(join(pkg, 'index.js'), "exports.chromium = { kind: 'fake' }\n")

  const found = await loadPlaywright(app)
  assert.equal(found.name, '@playwright/test')
  assert.deepEqual(found.chromium, { kind: 'fake' })
})
