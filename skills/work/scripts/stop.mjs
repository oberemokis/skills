#!/usr/bin/env node
// Гасит агента в панели сессии work: находит его процесс в дереве оболочки панели, шлёт TERM и CONT,
// ждёт выхода, а остановленного по Ctrl+Z добивает KILL. Оболочка панели остаётся, пространство
// herdr с ней тоже, место освобождается. `herdr pane close` для этого не годится: он закрывает панель.
//
//   stop.mjs <id панели> [--timeout 10]
//
// Вывод: JSON одной строкой, status none|stopped|killed|alive. Код выхода 0: агент вышел или его
// не было; 1: агент жив или herdr ответил ошибкой; 2: ошибка вызова.
import { parseArgs } from 'node:util'

import { paneAgent, stopAndWait } from './launch.mjs'

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { timeout: { type: 'string', default: '10' } } })
  const pane = positionals[0]
  const timeout = Number(values.timeout)
  if (!pane || !Number.isFinite(timeout) || timeout <= 0) {
    console.error('stop.mjs <id панели> [--timeout секунды]')
    process.exit(2)
  }
  const proc = paneAgent(pane)
  if (!proc) {
    console.log(JSON.stringify({ status: 'none', pane }))
    return
  }
  const status = await stopAndWait(proc, timeout)
  console.log(JSON.stringify({ status, pane, pid: proc.pid, agent: proc.kind }))
  if (status === 'alive') process.exit(1)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
