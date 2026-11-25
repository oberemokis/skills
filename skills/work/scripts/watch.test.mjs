import assert from 'node:assert/strict'
import { test } from 'node:test'

import { changes, snapshot } from './watch.mjs'

// Снимок в форме `herdr api snapshot`: только поля, которые читает надзор.
const pane = (id, { task, agent = 'claude', status = 'working', tokens } = {}) => ({
  pane_id: id,
  workspace_id: id.split(':')[0],
  ...(agent ? { agent, agent_status: status } : { agent_status: 'unknown' }),
  tokens: tokens ?? { work: '1', task, agent: 'claude' },
})
const snap = (panes, turns = {}) => ({
  panes,
  agents: panes.filter((p) => p.agent).map((p) => ({ pane_id: p.pane_id, completion_seq: turns[p.pane_id] ?? 3 })),
})

test('снимок: задача, агент, статус, ход, жив ли агент и остановлен ли он; чужие панели не входят', () => {
  const s = snap([
    pane('w1:p1', { task: 'PROJ-1' }),
    pane('w2:p1', { task: 'PROJ-2', status: 'blocked' }),
    pane('w3:p1', { tokens: { other: '1' } }),
    pane('w4:p1', { agent: 'claude' , tokens: {} }),
  ])
  assert.deepEqual(snapshot(s, (id) => id === 'w2:p1'), {
    'w1:p1': { pane: 'w1:p1', workspace: 'w1', task: 'PROJ-1', agent: 'claude', state: 'live', status: 'working', turn: 3, alive: true, stopped: false },
    'w2:p1': { pane: 'w2:p1', workspace: 'w2', task: 'PROJ-2', agent: 'claude', state: 'live', status: 'blocked', turn: 3, alive: true, stopped: true },
  })
})

test('агент вышел из панели: оболочка осталась, alive ложь, процессы не спрашиваются', () => {
  const s = snapshot(snap([pane('w1:p1', { task: 'PROJ-1', agent: null })]), () => assert.fail('без агента остановку не проверяют'))
  assert.equal(s['w1:p1'].alive, false)
  assert.equal(s['w1:p1'].status, null)
})

test('перемены: новый ход, пропавшая панель и новая панель; без перемен пусто', () => {
  const no = () => false
  const before = snapshot(snap([pane('w1:p1', { task: 'PROJ-1' }), pane('w2:p1', { task: 'PROJ-2' })]), no)
  assert.deepEqual(changes(before, before), [])

  const after = snapshot(snap([pane('w1:p1', { task: 'PROJ-1' }), pane('w3:p1', { task: 'PROJ-3' })], { 'w1:p1': 4 }), no)
  assert.deepEqual(
    changes(before, after).map((s) => [s.pane, s.state, s.turn]),
    [['w1:p1', 'live', 4], ['w3:p1', 'live', 3], ['w2:p1', 'gone', 3]],
  )
})
