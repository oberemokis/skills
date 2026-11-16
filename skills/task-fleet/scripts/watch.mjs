#!/usr/bin/env node
// Ждёт перемены у сессий задач fleet, терминалов hc с меткой task-fleet=1: статус агента, ход,
// агент в терминале, конец терминала. Печатает JSON изменившихся и выходит.
// Поток `hc events` шумный (заголовки, отметки «просмотрено»), поэтому решает сравнение снимков.
//
//   watch.mjs <файл снимка>
//
// Снимок с прошлого выхода лежит в файле: перемена между двумя запусками тоже попадёт в ответ.
// Код выхода 0: перемена; 3: поток событий закрылся (ядро перезапускалось), проверь всё заново.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

import { isClaude, readProcs } from './launch.mjs'

const LABEL = 'task-fleet=1'

const hc = (args) => JSON.parse(execFileSync('hc', args, { encoding: 'utf8' }))

function snapshot() {
  const out = {}
  const procs = readProcs()
  for (const { address } of hc(['ls', '--label', LABEL, '--json']).terminals ?? []) {
    const t = hc(['get', address, '--json'])
    out[address] = {
      address,
      task: t.labels?.task ?? null,
      state: t.state,
      status: t.status?.state ?? null,
      turn: t.turn ?? 0,
      app: t.status?.app ?? null,
      // Есть ли Claude в терминале. По app не понять: на вопросе о доверии папке статуса ещё нет.
      claude: isClaude(t, procs),
    }
  }
  return out
}

function changes(before, after) {
  const out = []
  for (const [address, now] of Object.entries(after)) {
    if (JSON.stringify(before[address]) !== JSON.stringify(now)) out.push(now)
  }
  for (const [address, was] of Object.entries(before)) {
    if (!(address in after)) out.push({ ...was, state: 'gone' })
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
    events.kill()
    process.exit(code)
  }

  const events = spawn('hc', ['events', '--label', LABEL, '--json'], { stdio: ['ignore', 'pipe', 'inherit'] })
  // Первая строка потока это снимок: на ней же видна перемена, случившаяся до запуска.
  createInterface({ input: events.stdout }).on('line', () => {
    const after = snapshot()
    const list = changes(before, after)
    if (list.length) done(0, list, after)
  })
  events.on('close', () => done(3, [], null))
}

main()
