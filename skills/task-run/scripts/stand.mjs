#!/usr/bin/env node
// Стенд задачи: записывает владельца порта и запускает сервер стенда. Звать фоном под локом порта,
// из `<worktree>/<stand.cwd>`:
//
//   flock -n -E 75 /tmp/task-run-port-<порт>.lock node stand.mjs <порт> <ID> <worktree> "<stand.start>"
//
// Лок держит flock, пока жив этот процесс, а он живёт, пока жив сервер: упал сервер, упал и лок.
// Команда стенда идёт через оболочку здесь, а не в команде агента: `sh -c` хук lean-ctx не пропускает.
// Код выхода сервера возвращается как есть; 2: ошибка вызова.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { constants } from 'node:os'

export const ownerFile = (port) => `/tmp/task-run-port-${port}.owner`

// Владелец пишется до старта сервера: занятый лок другая задача объясняет по этому файлу.
// Порт у каждой задачи свой, поэтому `{port}` в `stand.start` заменяется им, и он же лежит в PORT.
export function serve({ ownerPath, owner, command, cwd, port }) {
  writeFileSync(ownerPath, `${owner}\n`)
  return spawn(command.replaceAll('{port}', String(port)), {
    shell: true,
    stdio: 'inherit',
    cwd,
    env: { ...process.env, PORT: String(port) },
  })
}

function main() {
  const [port, id, worktree, command] = process.argv.slice(2)
  if (!/^\d+$/.test(port ?? '') || !id || !worktree || !command) {
    console.error('stand.mjs <порт> <ID> <worktree> "<stand.start>"')
    process.exit(2)
  }
  const child = serve({ ownerPath: ownerFile(port), owner: `${id} ${worktree}`, command, cwd: process.cwd(), port })
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code, signal) => process.exit(code ?? 128 + (constants.signals[signal] ?? 0)))
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) main()
