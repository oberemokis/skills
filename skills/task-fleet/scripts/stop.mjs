#!/usr/bin/env node
// Гасит агента в терминале сессии fleet: находит его процесс в дереве терминала, шлёт TERM и CONT,
// ждёт выхода. Оболочка обёртки остаётся, пространство Herdr с ней тоже, место освобождается.
// `hc kill` для этого не годится: он закрывает терминал, а с ним панель и пространство.
//
//   stop.mjs <адрес терминала> [--timeout 10]
//
// Вывод: JSON одной строкой. Код выхода 0: агент вышел или его не было; 1: агент жив после таймаута
// или hc ответил ошибкой; 2: ошибка вызова.
import { parseArgs } from 'node:util'

import { agentProcess, get, poll, readProcs, stopAgent } from './launch.mjs'

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { timeout: { type: 'string', default: '10' } } })
  const address = positionals[0]
  const timeout = Number(values.timeout)
  if (!address || !Number.isFinite(timeout) || timeout <= 0) {
    console.error('stop.mjs <адрес терминала> [--timeout секунды]')
    process.exit(2)
  }
  const proc = agentProcess(get(address), readProcs())
  if (!proc) {
    console.log(JSON.stringify({ status: 'none', address }))
    return
  }
  stopAgent(proc)
  const gone = await poll(() => !readProcs().some((p) => p.pid === proc.pid), timeout)
  console.log(JSON.stringify({ status: gone ? 'stopped' : 'alive', address, pid: proc.pid, agent: proc.kind }))
  if (!gone) process.exit(1)
}

main().catch((error) => {
  console.error(error.stderr?.toString().trim() || error.message)
  process.exit(1)
})
