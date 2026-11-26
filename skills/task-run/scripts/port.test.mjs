import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'

import { listening, pick } from './port.mjs'

// Порты как на машине: кто держит лок стенда и кто просто слушает.
const machine = ({ stands = {}, busy = [] }) => ({
  locked: (port) => port in stands,
  owner: (port) => stands[port] ?? null,
  listening: async (port) => busy.includes(port),
})

const cases = [
  { name: 'первая задача получает базовый порт', stands: {}, busy: [], want: { port: 3000, own: false } },
  { name: 'вторая задача берёт следующий порт', stands: { 3000: 'PROJ-1' }, busy: [3000], want: { port: 3001, own: false } },
  { name: 'свой поднятый стенд находится и второй не поднимается', stands: { 3000: 'PROJ-1', 3001: 'PROJ-2' }, busy: [3000, 3001], want: { port: 3001, own: true } },
  { name: 'порт без лока, но с чужим dev-сервером занят', stands: {}, busy: [3000], want: { port: 3001, own: false } },
  { name: 'свой стенд на дальнем порту важнее свободного ближнего', stands: { 3002: 'PROJ-2' }, busy: [3002], want: { port: 3002, own: true } },
  { name: 'упавший стенд оставил файл владельца, но лока нет: порт свободен', stands: {}, busy: [], want: { port: 3000, own: false } },
]

for (const { name, stands, busy, want } of cases) {
  test(`порт стенда: ${name}`, async () => {
    assert.deepEqual(await pick(3000, 'PROJ-2', machine({ stands, busy })), want)
  })
}

test('все десять портов заняты: порта нет', async () => {
  const busy = Array.from({ length: 10 }, (_, i) => 3000 + i)
  assert.equal(await pick(3000, 'PROJ-2', machine({ busy })), null)
  // Одиннадцатый порт уже не берётся: за пределом диапазона порт мог занять кто угодно.
  assert.equal(await pick(3000, 'PROJ-2', machine({ busy: busy.filter((p) => p !== 3010) })), null)
})

test('слушающий сервер виден настоящей проверкой порта', async (t) => {
  const server = createServer().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => server.close())
  const { port } = server.address()

  assert.equal(await listening(port), true)
  // Локов на тестовых портах нет, проверка порта настоящая.
  const result = await pick(port, 'PROJ-2', { locked: () => false, owner: () => null, listening })
  assert.equal(result.port, port + 1)
})
