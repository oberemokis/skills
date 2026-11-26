#!/usr/bin/env node
// Уборка Docker за задачей: контейнеры, сети, тома и образы, у которых ID задачи стоит в имени
// или в compose-проекте.
//
//   node docker.mjs <ID> [--dry]
//
// --dry только печатает, что нашлось. Ответ JSON {docker, found, removed, failed}. Контейнеры
// удаляются с -v, вместе с их анонимными томами. Образы без ID задачи в имени (общий образ проекта,
// базовые образы) и кеш сборки не трогаются. Docker не запущен: {docker: false}, код 0.
// Код 1: что-то не удалилось (том занят чужим контейнером, образ нужен другому); 2: ошибка вызова.
import { spawnSync } from 'node:child_process'

// PROJ-123 находит proj123test, test_proj123, proj-123-backend, но не proj1230 и не xproj123.
export function pattern(id) {
  const parts = id.toLowerCase().split(/[^a-z0-9]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/).filter(Boolean)
  const tail = /[0-9]$/.test(id) ? '(?![0-9])' : '(?![a-z0-9])'
  return new RegExp(`(?<![a-z0-9])${parts.join('[-_]?')}${tail}`, 'i')
}

export const labels = (text) =>
  Object.fromEntries(
    (text ?? '')
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const i = pair.indexOf('=')
        return i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)]
      }),
  )

const project = (row) => labels(row.Labels)['com.docker.compose.project'] ?? ''

export function plan(id, inventory) {
  const re = pattern(id)
  const ours = (name, row) => re.test(name) || re.test(project(row))
  return {
    containers: inventory.containers.filter((c) => ours(c.Names, c)).map((c) => c.Names),
    networks: inventory.networks.filter((n) => ours(n.Name, n)).map((n) => n.Name),
    volumes: inventory.volumes.filter((v) => ours(v.Name, v)).map((v) => v.Name),
    images: inventory.images
      .filter((i) => i.Repository !== '<none>' && re.test(i.Repository))
      .map((i) => `${i.Repository}:${i.Tag}`),
  }
}

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' })

const rows = (...args) =>
  docker(...args, '--format', '{{json .}}')
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

// Порядок важен: сеть и том не удалить, пока на них стоит контейнер.
const REMOVE = [
  ['containers', ['rm', '-f', '-v']],
  ['networks', ['network', 'rm']],
  ['volumes', ['volume', 'rm']],
  ['images', ['image', 'rm']],
]

function main() {
  const [id, ...rest] = process.argv.slice(2)
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || rest.some((a) => a !== '--dry')) {
    console.error('node docker.mjs <ID> [--dry]')
    process.exit(2)
  }
  if (docker('info', '--format', '{{.ID}}').status !== 0) {
    console.log(JSON.stringify({ docker: false }))
    return
  }
  const found = plan(id, {
    containers: rows('ps', '-a'),
    networks: rows('network', 'ls'),
    volumes: rows('volume', 'ls'),
    images: rows('images'),
  })
  const removed = { containers: [], networks: [], volumes: [], images: [] }
  const failed = []
  if (!rest.includes('--dry')) {
    for (const [kind, command] of REMOVE) {
      for (const name of found[kind]) {
        const r = docker(...command, name)
        if (r.status === 0) removed[kind].push(name)
        else failed.push({ kind, name, error: r.stderr.trim() })
      }
    }
  }
  console.log(JSON.stringify({ docker: true, found, removed, failed }, null, 2))
  if (failed.length) process.exit(1)
}

// import.meta.main, а не сравнение argv[1] с путём модуля: скилл стоит ссылкой на клон.
if (import.meta.main) main()
