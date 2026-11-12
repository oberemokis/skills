#!/usr/bin/env node
// Проверяет файл задачи или проекта task-run по схеме из ../schemas.
// check-json.mjs <файл>: ok или список ошибок, код 0 | 1.
// check-json.mjs --commit <файл.tmp>: при успехе переименовывает в <файл>, запись атомарная и только валидная.
import { readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const SCHEMAS = {
  'task-run/task@1': join(here, '../schemas/task.schema.json'),
  'task-run/project@1': join(here, '../schemas/project.schema.json'),
}

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function matchesType(value, type) {
  const actual = typeOf(value)
  return type === actual || (type === 'number' && actual === 'integer')
}

// Подмножество JSON Schema, которого хватает схемам task-run: зависимость от ajv в плагине не нужна.
export function validate(schema, value, path = '$') {
  const errors = []

  if (schema.type) {
    const types = [].concat(schema.type)
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: ожидался ${types.join(' | ')}, пришёл ${typeOf(value)}`)
      return errors
    }
  }

  if ('const' in schema && value !== schema.const) errors.push(`${path}: должно быть ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: допустимо ${schema.enum.join(', ')}`)

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: пустая строка`)
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: не подходит под ${schema.pattern}`)
  }

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: меньше ${schema.minimum}`)
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: нужно не меньше ${schema.minItems} элементов`)
    }
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items, item, `${path}[${index}]`)))
  }

  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: нет поля ${key}`)
    }

    for (const [key, child] of Object.entries(value)) {
      if (schema.propertyNames) errors.push(...validate(schema.propertyNames, key, `${path}.${key} (имя)`))

      const property = schema.properties?.[key]
      if (property) {
        errors.push(...validate(property, child, `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: лишнее поле ${key}`)
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(...validate(schema.additionalProperties, child, `${path}.${key}`))
      }
    }
  }

  for (const part of schema.allOf ?? []) errors.push(...validate(part, value, path))

  if (schema.if && schema.then && validate(schema.if, value, path).length === 0) {
    errors.push(...validate(schema.then, value, path))
  }

  return errors
}

export function checkDocument(document) {
  const schemaFile = SCHEMAS[document?.schema]
  if (!schemaFile) return [`$.schema: неизвестная схема ${JSON.stringify(document?.schema)}, ждём ${Object.keys(SCHEMAS).join(' или ')}`]

  return validate(JSON.parse(readFileSync(schemaFile, 'utf8')), document)
}

function main() {
  const args = process.argv.slice(2)
  const commit = args[0] === '--commit'
  const file = commit ? args[1] : args[0]

  if (!file || (commit && !file.endsWith('.tmp'))) {
    console.error('использование: check-json.mjs <файл> | check-json.mjs --commit <файл.tmp>')
    process.exit(2)
  }

  let document
  try {
    document = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.log(`${file}: не JSON (${error.message})`)
    process.exit(1)
  }

  const errors = checkDocument(document)
  if (errors.length > 0) {
    console.log(errors.join('\n'))
    process.exit(1)
  }

  if (commit) renameSync(file, file.slice(0, -'.tmp'.length))
  console.log('ok')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
