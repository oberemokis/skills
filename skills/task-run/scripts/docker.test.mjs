import assert from 'node:assert/strict'
import test from 'node:test'

import { labels, pattern, plan } from './docker.mjs'

test('ID задачи узнаётся в именах с любым разделителем, соседние номера не цепляются', () => {
  const cases = [
    ['proj123test_postgres_data', true],
    ['test_proj123', true],
    ['proj-123-backend', true],
    ['PROJ_123', true],
    ['proj1230', false],
    ['xproj123', false],
    ['proj12', false],
    ['shop_postgres_data', false],
  ]
  for (const [name, expected] of cases) assert.equal(pattern('PROJ-123').test(name), expected, name)
})

test('метки Docker разбираются в объект, пустое значение остаётся пустым', () => {
  assert.deepEqual(labels('com.docker.compose.project=proj124,com.docker.volume.anonymous='), {
    'com.docker.compose.project': 'proj124',
    'com.docker.volume.anonymous': '',
  })
  assert.deepEqual(labels(''), {})
})

test('уборка берёт ресурсы задачи по имени и compose-проекту, общий стек и базовые образы не трогает', () => {
  const compose = (p) => `com.docker.compose.project=${p}`
  const inventory = {
    containers: [
      { Names: 'proj123-manual-backend', Labels: compose('shop') },
      { Names: 'backend-1', Labels: compose('proj124') },
      { Names: 'shop-backend', Labels: compose('shop') },
    ],
    networks: [
      { Name: 'proj124_default', Labels: compose('proj124') },
      { Name: 'shop_default', Labels: compose('shop') },
      { Name: 'bridge', Labels: '' },
    ],
    volumes: [
      { Name: 'proj124_postgres_data', Labels: compose('proj124') },
      { Name: 'shop_postgres_data', Labels: compose('shop') },
      { Name: '2d6bd760', Labels: 'com.docker.volume.anonymous=' },
    ],
    images: [
      { Repository: 'proj124-backend', Tag: 'latest' },
      { Repository: 'shop-dev-backend', Tag: 'latest' },
      { Repository: '<none>', Tag: '<none>' },
      { Repository: 'postgres', Tag: '16' },
    ],
  }
  assert.deepEqual(plan('PROJ-124', inventory), {
    containers: ['backend-1'],
    networks: ['proj124_default'],
    volumes: ['proj124_postgres_data'],
    images: ['proj124-backend:latest'],
  })
  assert.deepEqual(plan('PROJ-123', inventory).containers, ['proj123-manual-backend'])
})
