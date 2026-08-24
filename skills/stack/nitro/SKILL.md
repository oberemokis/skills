---
name: nitro
description: Серверная часть Nuxt: обработчики событий, чтение запроса, ошибки, middleware, правила роутов, кеширование, хранилище, задачи. Читать при работе с каталогом server, файлами в server/api и server/routes, правилами routeRules и деплоем сервера.
---

# Nitro

> Точка входа: [skills/core](../../core/SKILL.md). Если core ещё не прочитан, прочитать его до этого скилла.

Версия: `nitropack@2.13.4`, актуальная на момент написания, с `h3@1.15.11` внутри. Имена всех функций ниже сверены с типами пакета, а не взяты по памяти.

Версия выше не украшение. Правила про поведение переживают мажорные обновления, а всё из раздела «Привязано к версии» перестаёт быть верным вместе с ней: если в `package.json` версия другая, сверь имена до того, как напишешь.

Про h3 отдельно. Nitro 2 тянет ветку 1.x, а под тегом `latest` у h3 лежит уже предварительный выпуск второй версии, где часть функций переименована. Проверяй имена по той h3, что стоит внутри вашего nitropack, а не по её документации в сети.

## Когда применять

- обработчики в `server/api` и `server/routes`, серверные middleware
- `routeRules` в `nuxt.config.ts`: кеш, редиректы, прокси, заголовки
- хранилище, кеширование ответов, задачи по расписанию

## Когда НЕ применять

- страницы, загрузка данных на клиенте, `useFetch`: это `nuxt`
- код компонентов: это `vue`
- конфигурация сборки клиента: это `vite`

## Правила

### Обработчик объявляется defineEventHandler, ошибка бросается createError

```ts
// хорошо
export default defineEventHandler(async (event) => {
  const orderId = getRouterParam(event, "id")
  if (!orderId) {
    throw createError({ statusCode: 400, statusMessage: "id обязателен" })
  }

  return await loadOrder(orderId)
})
```

```ts
// плохо: обычная ошибка станет пятисоткой без внятного тела
export default defineEventHandler(async (event) => {
  throw new Error("id обязателен")
})
```

Тело читается через `readBody`, а лучше через `readValidatedBody` со схемой. Строка запроса через `getQuery`, параметры пути через `getRouterParam` и `getRouterParams`, заголовки через `getHeader` и `setHeader`, статус через `setResponseStatus`, редирект через `sendRedirect`.

### Middleware ничего не возвращает

Возврат значения из middleware завершает запрос, и обработчик не вызывается. Выглядит это как безобидный `return`.

```ts
// хорошо
export default defineEventHandler((event) => {
  event.context.user = parseUser(event)
})
```

```ts
// плохо: запрос закончится здесь
export default defineEventHandler((event) => {
  return parseUser(event)
})
```

### Правила роутов наследуются, отменяются через false

Правила сливаются от менее специфичного пути к более специфичному, поэтому унаследованное правило надо снимать явно.

```ts
// хорошо
routeRules: {
  "/api/**": { cors: true, cache: { maxAge: 60 } },
  "/api/live/**": { cache: false },
  "/old-blog/**": { redirect: "https://blog.example.com/**" },
}
```

```ts
// плохо: живой роут унаследует кеш на минуту, а редирект потеряет хвост пути
routeRules: {
  "/api/**": { cors: true, cache: { maxAge: 60 } },
  "/api/live/**": { cors: true },
  "/old-blog/**": { redirect: "https://blog.example.com" },
}
```

Подстановка в редиректе сохраняет хвост пути, поэтому `**` нужен с обеих сторон. `swr: true` это сокращение `cache: { swr: true }`, а `swr: 600` добавляет к нему `maxAge`. Правила можно переопределить в рантайме через `runtimeConfig.nitro.routeRules`, без пересборки.

### Несколько параметров это отдельные сегменты

```
server/api/orders/[orderId]/items/[itemId].get.ts   хорошо
server/api/orders/[orderId]-[itemId].get.ts         плохо
```

`[...name].ts` захватывает остаток пути вместе со слешами, `[...].ts` работает как глобальный перехватчик. Суффикс окружения ставится после суффикса метода: `orders.get.prod.ts`.

### Кеширование объявляется на обработчике или на функции

```ts
// хорошо: кеш на уровне обработчика
export default defineCachedEventHandler(
  async (event) => await loadRates(),
  { maxAge: 300, name: "rates" },
)

// либо на уровне функции, если результат нужен в нескольких местах
const loadRates = defineCachedFunction(async () => fetchRates(), {
  maxAge: 300,
  name: "rates",
})
```

```ts
// плохо: имени нет, ключ кеша привязан к расположению кода
export default defineCachedEventHandler(async (event) => await loadRates(), {
  maxAge: 300,
})
```

Имя задавай явно: без него ключ кеша выводится из расположения кода и меняется при переносе.

## Привязано к версии

Главная ловушка этого скилла в обратную сторону. В Nitro 3 и H3 второй версии API переименован целиком, и модель может предложить именно те имена, потому что они новее. В установленных пакетах их нет.

| Существует в Nitro 3 и H3 v2 | Здесь это |
| --- | --- |
| `defineHandler` из `"nitro"` | `defineEventHandler` |
| `event.req.json()` | `readBody(event)` |
| `event.res.headers.set()` | `setHeader(event, name, value)` |
| `throw new HTTPError({ status: 404 })` | `throw createError({ statusCode: 404 })` |
| импорты из `nitro/storage`, `nitro/cache` | автоимпорты `useStorage`, `defineCachedEventHandler` |
| пакет `nitro` | пакет `nitropack` |

Если увидишь в коде левый столбец, значит либо проект обновили, либо кто-то писал по документации другого мажора. Проверь `package.json` до правки.

## Антипаттерны

| Не так | Так | Почему |
| --- | --- | --- |
| `throw new Error(...)` в обработчике | `createError` со статусом | иначе клиент получит пятисотку без внятного тела |
| `return` в middleware | присвоить в `event.context` | возврат завершает запрос, обработчик не вызовется |
| `readBody` без проверки | `readValidatedBody` со схемой | тело приходит из внешнего мира и произвольно |
| два параметра в одном сегменте имени файла | отдельные сегменты | роутер разбирает путь по сегментам |
| кеш без явного `name` | задать имя | ключ иначе зависит от расположения кода |
| кеш на обработчике с персональными данными | кешировать только общее | ответ уедет другому пользователю |
| `import.meta.env` в серверном коде | `useRuntimeConfig()` | это переменные клиентской сборки |
| секреты в `runtimeConfig.public` | приватная часть `runtimeConfig` | публичная часть уезжает в браузер |

## Ссылки

- Имена функций сверены с `node_modules/h3/dist/index.d.mts` и автоимпортами Nitro в `.nuxt/types/nitro-imports.d.ts`. При сомнении смотри туда же, это точнее любой документации
