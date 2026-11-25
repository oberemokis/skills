#!/usr/bin/env node
// Говорит, идёт ли процесс в панели herdr: поднимается по предкам до сервера herdr, который держит
// оболочки панелей. Переменным окружения верить нельзя, HERDR_* наследуются во всё, что запущено из панели.
// Вывод: herdr | none | unknown (ps не ответил), код выхода 0 | 1 | 2.
import { execFileSync } from 'node:child_process'

// Сервер herdr, `…/herdr server`: оболочка панели его прямой ребёнок. Клиент `herdr` без `server`
// панелей не держит. Путь бывает с пробелом, поэтому ищется подстрока во всей командной строке.
const HERDR_SERVER = /(^|\/)herdr server( |$)/

// readProc(pid) → { ppid, command } или null, если ps не ответил.
export function detectHost(pid, readProc) {
  const seen = new Set()
  let current = pid
  while (current > 1 && !seen.has(current)) {
    seen.add(current)
    const proc = readProc(current)
    if (proc === null) return 'unknown'
    if (HERDR_SERVER.test(proc.command)) return 'herdr'
    current = proc.ppid
  }
  return 'none'
}

function readProc(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    const match = out.match(/^(\d+)\s+([\s\S]*)$/)
    return match ? { ppid: Number(match[1]), command: match[2] } : null
  } catch {
    return null
  }
}

function main() {
  const host = detectHost(process.pid, readProc)
  console.log(host)
  process.exit(host === 'herdr' ? 0 : host === 'none' ? 1 : 2)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) main()
