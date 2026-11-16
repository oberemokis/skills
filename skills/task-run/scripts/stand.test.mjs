import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { serve } from './stand.mjs'

test('владелец записан до старта, команда стенда идёт через оболочку в папке стенда, код выхода сервера сохраняется', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'stand-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ownerPath = join(dir, 'owner')

  // Команда со встроенным кодом: ради неё скрипт и существует.
  const child = serve({ ownerPath, owner: 'EYE-1 /p/.worktrees/feature-EYE-1', command: 'pwd > where; exit 3', cwd: dir })
  const [code] = await once(child, 'exit')

  assert.equal(code, 3)
  assert.equal(readFileSync(ownerPath, 'utf8'), 'EYE-1 /p/.worktrees/feature-EYE-1\n')
  // `where` лёг в dir, значит команда шла из папки стенда; pwd на macOS отдаёт путь через /private.
  assert.equal(realpathSync(readFileSync(join(dir, 'where'), 'utf8').trim()), realpathSync(dir))
})
