import assert from 'node:assert/strict'
import { test } from 'node:test'

import { changes, snapshot } from './watch.mjs'

const proc = (pid, ppid, args, stat = 'S+') => ({ pid, ppid, stat, argv0: args.split(' ')[0], args })

// Ядро hc в форме ответов `ls` и `get`: только поля, которые читает надзор.
function fakeHc(terminals) {
  return (args) => {
    if (args[0] === 'ls') return { terminals: Object.keys(terminals).map((address) => ({ address })) }
    if (args[0] === 'get') return terminals[args[1]]
    throw new Error(`неожиданный вызов hc ${args.join(' ')}`)
  }
}

const fleet = (pid, { task, app = 'claude-code', state = 'working', turn = 3 } = {}) => ({
  pid,
  state: 'live',
  turn,
  labels: { 'task-fleet': '1', task, agent: 'claude' },
  status: app ? { app, state } : null,
  foreground: { argv: ['/bin/zsh'], pid },
})

test('снимок: задача, агент, статус, жив ли агент и остановлен ли он', () => {
  const hc = fakeHc({ t1: fleet(100, { task: 'PROJ-1' }), t2: fleet(200, { task: 'PROJ-2', app: null }) })
  const procs = [proc(100, 1, '/bin/zsh'), proc(101, 100, 'claude'), proc(200, 1, '/bin/zsh'), proc(201, 200, 'claude', 'T')]
  assert.deepEqual(snapshot(hc, procs), {
    t1: { address: 't1', task: 'PROJ-1', agent: 'claude', state: 'live', status: 'working', turn: 3, app: 'claude-code', alive: true, stopped: false },
    t2: { address: 't2', task: 'PROJ-2', agent: 'claude', state: 'live', status: null, turn: 3, app: null, alive: true, stopped: true },
  })
})

test('агент вышел из терминала: оболочка осталась, alive ложь', () => {
  const hc = fakeHc({ t1: fleet(100, { task: 'PROJ-1', app: null }) })
  assert.equal(snapshot(hc, [proc(100, 1, '/bin/zsh')]).t1.alive, false)
})

test('перемены: новый ход, пропавший терминал и новый терминал; без перемен пусто', () => {
  const hc = fakeHc({ t1: fleet(100, { task: 'PROJ-1' }), t2: fleet(200, { task: 'PROJ-2' }) })
  const procs = [proc(100, 1, '/bin/zsh'), proc(101, 100, 'claude'), proc(200, 1, '/bin/zsh'), proc(201, 200, 'claude')]
  const before = snapshot(hc, procs)
  assert.deepEqual(changes(before, before), [])

  const after = snapshot(fakeHc({ t1: fleet(100, { task: 'PROJ-1', turn: 4 }), t3: fleet(300, { task: 'PROJ-3' }) }), procs)
  assert.deepEqual(
    changes(before, after).map((s) => [s.address, s.state, s.turn]),
    [['t1', 'live', 4], ['t3', 'live', 3], ['t2', 'gone', 3]],
  )
})
