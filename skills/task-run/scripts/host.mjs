#!/usr/bin/env node
// Говорит, идёт ли процесс в терминале Herdr (ядро hc): поднимается по предкам до первого,
// кто держит терминал. Переменным окружения верить нельзя, HERDR_* и HC_* наследуются в обе стороны.
// Вывод: hc | none | unknown (ps не ответил), код выхода 0 | 1 | 2.
import { execFileSync } from 'node:child_process'

// Держатель терминала hc, `…/herdr-core hold --socket …`: путь до него бывает с пробелом,
// поэтому ищется подстрока во всей командной строке, а не первое слово.
const HC_HOLDER = /(^|\/)herdr-core hold( |$)/
// Сервер старого herdr: его панели наследуют HC_* от терминала, из которого он запущен.
const HERDR_SERVER = /(^|\/)herdr server( |$)/

// readProc(pid) → { ppid, command } или null, если ps не ответил.
export function detectHost(pid, readProc) {
  const seen = new Set()
  let current = pid
  while (current > 1 && !seen.has(current)) {
    seen.add(current)
    const proc = readProc(current)
    if (proc === null) return 'unknown'
    // Решает ближний держатель: старый herdr внутри терминала hc это не Herdr.
    if (HC_HOLDER.test(proc.command)) return 'hc'
    if (HERDR_SERVER.test(proc.command)) return 'none'
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
  process.exit(host === 'hc' ? 0 : host === 'none' ? 1 : 2)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон, и через неё пути расходятся.
if (import.meta.main) main()
