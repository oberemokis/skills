#!/usr/bin/env node
// Ждёт перемены у сессий задач work, панелей herdr с меткой work=1: статус агента, ход,
// агент в панели и его остановка, конец панели. Печатает JSON изменившихся и выходит.
// События herdr шумные (заголовок, прокрутка, фокус), поэтому они только будят, а решает сравнение снимков.
//
//   watch.mjs <файл снимка>
//
// Снимок с прошлого выхода лежит в файле: перемена между двумя запусками тоже попадёт в ответ.
// Код выхода 0: перемена; 3: сокет herdr закрылся (сервер перезапускался), проверь всё заново.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { createInterface } from 'node:readline'

import { herdr, MARK, paneAgent, readProcs, socketPath } from './launch.mjs'

const EVENTS = ['pane.updated', 'pane.closed', 'pane.exited', 'pane.agent_detected', 'workspace.closed']

// Снимок herdr и остановка агента подменяются в тестах.
export function snapshot(snap = herdr(['api', 'snapshot']).snapshot, stoppedOf = stopped) {
  const turns = new Map((snap.agents ?? []).map((a) => [a.pane_id, a.completion_seq ?? 0]))
  const out = {}
  for (const p of snap.panes ?? []) {
    if (p.tokens?.[MARK] !== '1') continue
    const alive = Boolean(p.agent)
    out[p.pane_id] = {
      pane: p.pane_id,
      workspace: p.workspace_id,
      task: p.tokens.task ?? null,
      agent: p.tokens.agent ?? null,
      state: 'live',
      status: alive ? p.agent_status : null,
      turn: turns.get(p.pane_id) ?? 0,
      // Есть ли агент в панели. herdr видит его и на вопросе о доверии папке, и после Ctrl+Z.
      alive,
      // Агент остановлен (Ctrl+Z): сессия жива, перезапуск не нужен.
      stopped: alive && stoppedOf(p.pane_id),
    }
  }
  return out
}

let procs = null
function stopped(pane) {
  procs ??= readProcs()
  try {
    return paneAgent(pane, procs)?.stopped ?? false
  } catch {
    // Панель закрылась между снимком и вопросом: следующий снимок её не найдёт.
    return false
  }
}

export function changes(before, after) {
  const out = []
  for (const [pane, now] of Object.entries(after)) {
    if (JSON.stringify(before[pane]) !== JSON.stringify(now)) out.push(now)
  }
  for (const [pane, was] of Object.entries(before)) {
    if (!(pane in after)) out.push({ ...was, state: 'gone' })
  }
  return out
}

function save(file, data) {
  writeFileSync(`${file}.tmp`, JSON.stringify(data))
  renameSync(`${file}.tmp`, file)
}

function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('нужен путь к файлу снимка')
    process.exit(2)
  }
  const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : snapshot()
  const done = (code, list, after) => {
    if (after) save(file, after)
    console.log(JSON.stringify(list))
    process.exit(code)
  }

  // Пачку событий проверяет один снимок.
  let queued = false
  const check = () => {
    if (queued) return
    queued = true
    setImmediate(() => {
      queued = false
      procs = null
      const after = snapshot()
      const list = changes(before, after)
      if (list.length) done(0, list, after)
    })
  }

  const socket = connect(socketPath())
  socket.on('connect', () => {
    const subscriptions = EVENTS.map((type) => ({ type }))
    socket.write(`${JSON.stringify({ id: 'work-watch', method: 'events.subscribe', params: { subscriptions } })}\n`)
  })
  // Первая строка это подтверждение подписки: на ней же видна перемена, случившаяся до запуска.
  createInterface({ input: socket }).on('line', check)
  socket.on('error', (error) => {
    console.error(error.message)
    done(3, [], null)
  })
  socket.on('close', () => done(3, [], null))
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) main()
