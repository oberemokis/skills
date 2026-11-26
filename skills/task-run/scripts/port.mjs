#!/usr/bin/env node
// Порт стенда задачи: свой уже поднятый стенд или первый свободный из `stand.port` и девяти следующих.
//
//   node port.mjs <stand.port> <ID>
//
// Ответ JSON {port, own}: own значит, что на порту уже стоит стенд этой задачи, поднимать его не надо.
// Порт свободен, когда его лок не держит ни один stand.mjs и на нём никто не слушает: чужой dev-сервер
// без лока тоже занимает порт. Код 4: все десять портов заняты; 2: ошибка вызова.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'

import { ownerFile } from './stand.mjs'

export const SPAN = 10
export const lockFile = (port) => `/tmp/task-run-port-${port}.lock`

// Лок держит stand.mjs под flock: пробный flock с кодом 75 значит, что стенд жив.
const locked = (port) => spawnSync('flock', ['-n', '-E', '75', lockFile(port), 'true']).status === 75

const owner = (port) => (existsSync(ownerFile(port)) ? readFileSync(ownerFile(port), 'utf8').split(' ')[0].trim() : null)

// Dev-сервер слушает либо IPv4, либо IPv6, поэтому спрашиваются оба адреса.
const answers = (host, port) =>
  new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 500 })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
    socket.on('timeout', () => done(false))
  })

export const listening = async (port) => (await answers('127.0.0.1', port)) || (await answers('::1', port))

export async function pick(base, id, probe = { locked, owner, listening }) {
  const ports = Array.from({ length: SPAN }, (_, i) => base + i)
  for (const port of ports) if (probe.locked(port) && probe.owner(port) === id) return { port, own: true }
  for (const port of ports) if (!probe.locked(port) && !(await probe.listening(port))) return { port, own: false }
  return null
}

async function main() {
  const [base, id] = process.argv.slice(2)
  if (!/^\d+$/.test(base ?? '') || !id) {
    console.error('port.mjs <stand.port> <ID>')
    process.exit(2)
  }
  const result = await pick(Number(base), id)
  console.log(JSON.stringify(result ?? { port: null, own: false }))
  process.exit(result ? 0 : 4)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) await main()
