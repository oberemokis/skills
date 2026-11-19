import test from 'node:test'
import assert from 'node:assert/strict'
import { defaults, predict, simulate } from './estimate.mjs'

test('ручные минуты на границе уровня не округляются и не зависят от весов плана', () => {
  const config = { ...defaults, base: 200, thresholds: [10, 20, 40, 80] }

  assert.deepEqual(predict({ minutes: 20 }, config), { minutes: 20, band: 'T2' })
  assert.deepEqual(predict({ minutes: 21 }, config), { minutes: 21, band: 'T3' })
})

test('веса проекта меняют прогноз, неизвестное число случаев не считается нулём', () => {
  const config = { ...defaults, base: 4, perExtraFile: 2, perCase: 5 }

  assert.deepEqual(predict({ files: 2, cases: 2 }, config), { minutes: 16, band: 'T2' })
  assert.throws(() => predict({ files: 2 }, config), /план/)
})

test('факт контрольной задачи меняет ошибку, но не подобранные веса', () => {
  const train = [{ files: 1, cases: 0, actual: 6 }, { files: 1, cases: 2, actual: 8 }]
  const run = actual => simulate([...train, { files: 1, cases: 1, actual }], 2)

  const first = run(7), later = run(60)

  assert.deepEqual(first.fitted, later.fitted)
  assert.equal(first.scores.fitted.mae, 0)
  assert.equal(later.scores.fitted.bias, -53)
  assert.equal(later.scores.tracker, null)
})
