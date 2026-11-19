#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const json = path => JSON.parse(readFileSync(path, 'utf8'))
export const defaults = json(new URL('../model.json', import.meta.url))
const integer = (n, min) => Number.isSafeInteger(n) && n >= min

function checkModel(model) {
  for (const k of ['base', 'perExtraFile', 'perCase']) {
    if (!Number.isFinite(model[k]) || model[k] < 0) throw new Error(`неверный вес: ${k}`)
  }
  if (!Array.isArray(model.thresholds) || model.thresholds.length !== 4 ||
    !model.thresholds.every((v, i, a) => integer(v, 1) && (!i || v > a[i - 1]))) {
    throw new Error('thresholds: четыре возрастающих порога в минутах')
  }
}

function fromPlan({ files, cases }, { base, perExtraFile, perCase }) {
  if (!integer(files, 1) || !integer(cases, 0)) throw new Error('нужен план: files >= 1 и cases >= 0, целые')
  return Math.max(1, Math.round(base + perExtraFile * (files - 1) + perCase * cases))
}

export function predict(input, model = defaults) {
  checkModel(model)
  const minutes = 'minutes' in input ? input.minutes : fromPlan(input, model)
  if (!integer(minutes, 1)) throw new Error('minutes: целое больше нуля')
  return { minutes, band: `T${1 + model.thresholds.filter(n => minutes > n).length}` }
}

function median(values) {
  const a = values.toSorted((x, y) => x - y)
  return (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2
}

// Поиск маленькой целочисленной модели. Цена промаха в обе стороны одинакова.
function fit(train, config) {
  let best = config
  const loss = model => train.reduce((sum, row) => sum + Math.abs(fromPlan(row, model) - row.actual), 0)
  let min = loss(best)
  for (let base = 5; base <= 30; base++) {
    for (let perExtraFile = 0; perExtraFile <= 12; perExtraFile++) {
      for (let perCase = 0; perCase <= 12; perCase++) {
        const candidate = { ...config, base, perExtraFile, perCase }
        const cost = loss(candidate)
        if (cost < min) { min = cost; best = candidate }
      }
    }
  }
  return best
}

const rounded = x => Math.round(100 * x) / 100
function score(rows, fn) {
  if (!rows.length) return null
  const errors = rows.map(row => fn(row) - row.actual)
  const mean = a => rounded(a.reduce((s, v) => s + v, 0) / a.length)
  return { n: errors.length, mae: mean(errors.map(Math.abs)), bias: mean(errors), maxError: Math.max(...errors.map(Math.abs)) }
}

export function simulate(rows, trainCount, config = defaults) {
  checkModel(config)
  if (!Array.isArray(rows) || !integer(trainCount, 2) || trainCount >= rows.length) {
    throw new Error('для симуляции нужны минимум две обучающие задачи и одна контрольная')
  }
  for (const row of rows) {
    fromPlan(row, config)
    if (!integer(row.actual, 1) || (row.tracker != null && !integer(row.tracker, 1))) {
      throw new Error('actual и известный tracker должны быть положительными целыми минутами')
    }
  }
  const train = rows.slice(0, trainCount)
  const holdout = rows.slice(trainCount)
  const fitted = fit(train, config)
  const typical = median(train.map(r => r.actual))
  const paired = train.filter(r => r.tracker != null)
  const ratio = paired.length ? median(paired.map(r => r.actual / r.tracker)) : null
  const withTracker = holdout.filter(r => r.tracker != null)
  return {
    train: train.length, holdout: holdout.length, fitted,
    typical, trackerRatio: ratio === null ? null : rounded(ratio),
    scores: {
      fitted: score(holdout, r => fromPlan(r, fitted)),
      configured: score(holdout, r => fromPlan(r, config)),
      constant: score(holdout, () => typical),
      tracker: score(withTracker, r => r.tracker),
      scaledTracker: ratio === null ? null : score(withTracker, r => Math.round(r.tracker * ratio)),
    },
  }
}

// Снимки плана нужны даже у ручных оценок; не восстанавливать их из итогового диффа.
function history(path) {
  if (!statSync(path).isDirectory()) return json(path)
  const states = readdirSync(path).filter(name => name.endsWith('.json')).map(name => json(join(path, name)))
  return states.filter(s => s.stage?.code === 'close' && s.stage.status === 'done' && s.estimate?.actualMinutes != null)
    .sort((a, b) => Date.parse(a.stage.since) - Date.parse(b.stage.since))
    .map(({ estimate: e }) => ({ files: e.files, cases: e.cases, actual: e.actualMinutes,
      tracker: e.source === 'tracker' ? e.minutes : null }))
}

if (import.meta.main) {
  try {
    const { values, positionals: [cmd, ...args] } = parseArgs({
      allowPositionals: true, options: { config: { type: 'string' } },
    })
    const config = values.config ? json(values.config) : defaults
    let result
    if (cmd === 'plan' && args.length === 2) result = predict({ files: Number(args[0]), cases: Number(args[1]) }, config)
    else if (cmd === 'manual' && args.length === 1) result = predict({ minutes: Number(args[0]) }, config)
    else if (cmd === 'simulate' && args.length === 2) result = simulate(history(args[0]), Number(args[1]), config)
    else throw new Error('estimate.mjs plan FILES CASES | manual MINUTES | simulate HISTORY TRAIN_COUNT [--config MODEL.json]')
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
