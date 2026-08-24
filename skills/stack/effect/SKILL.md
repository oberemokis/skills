---
name: effect
description: Effect 3 в монорепе: сервисы через Effect.Service со слоем Default, ошибки как Data.TaggedError, Effect.gen и почему в нём нельзя async, Option вместо null, разделение сервиса и репозитория. Читать перед написанием или правкой кода на Effect.
---

# Effect

> Точка входа: [skills/core](../../core/SKILL.md). Если core ещё не прочитан, прочитать его до этого скилла.

Версия: `effect@3.22.1`, третья мажорная и актуальная на момент написания. Четвёртая существует только как предварительный выпуск: под тегом `latest` лежит третья, четвёртая под `rc` и `beta`.

Версия выше не украшение. Правила про поведение переживают мажорные обновления, а всё из раздела «Привязано к версии» перестаёт быть верным вместе с ней: если в `package.json` версия другая, сверь имена до того, как напишешь.

Главная опасность здесь обратная обычной. Четвёртая версия переименовала почти всё и уже попала в обучающие данные, поэтому свежие примеры описывают API, которого в стабильном пакете нет. Раздел «Привязано к версии» защищает от того, чтобы притащить его сюда.

## Когда применять

- пишешь или правишь код на Effect
- заводишь сервис, репозиторий или типизированную ошибку
- разбираешься, почему тип не сходится или зависимость не разрешается

## Когда НЕ применять

- обычный код без Effect: правила типизации в `typescript`
- код компонентов: это `vue`, Effect там не место
- миграция на четвёртую версию: это отдельная работа, а не правка по ходу

## Соглашения

- сервис и репозиторий лежат в отдельных файлах, `service.ts` и `repository.ts`
- ошибки в своём модуле `errors.ts`
- сервис объявляется классом через `Effect.Service` с `accessors: true`
- зависимости перечисляются слоями `Default` в поле `dependencies`
- отсутствие значения выражается через `Option`, а не через `null`
- вспомогательные функции вынесены наружу и подставляются в `pipe`

## Правила

### Сервис объявляется классом Effect.Service

```ts
// хорошо
export class PostsService extends Effect.Service<PostsService>()(
  "PostsService",
  {
    accessors: true,
    dependencies: [PostsRepository.Default],
    effect: Effect.gen(function* () {
      const repository = yield* PostsRepository

      return {
        list: () => repository.findAll(),
      }
    }),
  },
) {}
```

```ts
// плохо: имена из четвёртой версии, в третьей их нет
export class PostsService extends Context.Service<PostsService>()(
  "app/posts/PostsService",
) {}
```

`dependencies` принимает слои, и у сервиса, объявленного через `Effect.Service`, слой генерируется автоматически под именем `Default`. Именно этой автоматики в четвёртой версии больше нет, поэтому примеры оттуда сюда не переносятся.

`accessors: true` даёт доступ к методам сервиса без ручного `yield*` на каждый вызов.

### Ошибка это класс, а не строка

```ts
// хорошо
export class PostNotFound extends Data.TaggedError("PostNotFound")<{
  readonly id: number
}> {}
```

```ts
// плохо: тег потерян, catchTag работать не будет
export const postNotFound = (id: number) =>
  Effect.fail(`пост ${id} не найден`)
```

Тег это дискриминатор, по нему работает `Effect.catchTag`. Поля объявляются `readonly` и несут контекст ошибки: что искали и с какими данными.

### Провал возвращается через return yield*

```ts
// хорошо
const post = yield* repository.findById(id)
if (Option.isNone(post)) {
  return yield* new PostNotFound({ id })
}
```

```ts
// плохо: без return TypeScript считает, что выполнение продолжится
if (Option.isNone(post)) {
  yield* new PostNotFound({ id })
}
```

Без `return` тип успеха выводится неверно, и ошибка всплывёт ниже в непонятном месте.

### Внутри Effect.gen нет async, await и throw

Генератор синтаксически похож на асинхронную функцию, и это главная ловушка.

```ts
// хорошо
Effect.gen(function* () {
  const response = yield* fetchPost(id)

  return response
})
```

```ts
// плохо: не скомпилируется, а если обойти типы, сломается семантика
Effect.gen(async function* () {
  const response = await fetch(url)

  return response
})
```

Effect это описание работы, а не запущенная работа. Сохранив его в переменную, вы не получите кеш: при каждом запуске он выполняется заново.

### Отсутствие значения выражается Option

```ts
// хорошо
const orNotFound = (id: number) =>
  Option.match({
    onNone: () => new PostNotFound({ id }),
    onSome: Effect.succeed,
  })

repository.findById(id).pipe(Effect.flatMap(orNotFound(id)))
```

```ts
// плохо: null уезжает вниз, и каждый вызывающий обязан его проверять
const post = yield* repository.findById(id)
if (post === null) return yield* new PostNotFound({ id })
```

### Сервис не ходит в базу сам

Репозиторий знает про хранилище, сервис знает про правила. Разделение видно по файлам и держится тем, что репозиторий это отдельный сервис в `dependencies`.

```ts
// хорошо: сервис получает репозиторий зависимостью
dependencies: [PostsRepository.Default]
```

```ts
// плохо: запрос внутри сервиса, подменить нечем
effect: Effect.gen(function* () {
  const rows = yield* sql`select * from posts`
})
```

Это то же правило, что в `test`: подменяется граница процесса, а не свой модуль. Репозиторий и есть та граница.

## Привязано к версии

Здесь третья версия. Всё в правом столбце это четвёртая, и писать это в текущем коде нельзя: таких имён в установленном пакете нет.

| Здесь, в третьей | В четвёртой стало |
| --- | --- |
| `Effect.Service` со слоем `Default` и полем `dependencies` | `Context.Service`, слой пишется руками через `Layer.effect` |
| `Context.Tag` | `Context.Service` |
| `Either` | `Result` |
| `catchAll`, `catchAllCause` | `catch`, `catchCause` |
| `Layer.scoped` | `Layer.effect` |
| `FiberRef` | `Context.Reference` |
| `Effect.fork`, `Effect.forkDaemon` | `Effect.forkChild`, `Effect.forkDetach` |
| `Micro`, `Runtime<R>` | удалены |

Признак, по которому видно, что пример из документации не подходит: в нём `Context.Service`, `Result` или слой, собранный руками. Такой пример относится к четвёртой версии.

В четвёртой версии в пакете появляется файл `AGENTS.md` с агентской документацией. В третьей его нет, поэтому источником правды остаются исходники в `node_modules/effect/src`.

Переход на четвёртую это не правка по ходу: там переехали сервисы, ошибки и половина имён, а часть функциональности живёт в `effect/unstable/*`, где ломающие изменения разрешены в минорных выпусках.

## Антипаттерны

### Имена из четвёртой версии

```ts
// плохо: ничего из этого в третьей версии не существует
import { Result } from "effect"

export class Db extends Context.Service<Db>()("app/Db") {}
program.pipe(Effect.catch(handler))
```

```ts
// хорошо
import { Either } from "effect"

export class Db extends Effect.Service<Db>()("Db", {
  effect: make,
}) {}
program.pipe(Effect.catchAll(handler))
```

### Обход системы эффектов

```ts
// плохо
Effect.gen(function* () {
  const data = await fetch(url) // await внутри генератора
  throw new Error("не вышло") // throw станет дефектом, а не ошибкой в канале E
  const now = new Date() // время не подменить в тесте
  const id = Math.random() // и случайность тоже
})
```

```ts
// хорошо
Effect.gen(function* () {
  const data = yield* httpClient.get(url)
  if (!data.ok) return yield* new RequestFailed({ url })

  const now = yield* DateTime.now
  const id = yield* Random.nextInt
})
```

### Прочее

| Не так | Так | Почему |
| --- | --- | --- |
| `Effect.fail("строка")` | класс через `Data.TaggedError` | без тега не работает `catchTag` |
| функция, возвращающая `Effect.gen(...)` | `Effect.fn("имя")` | иначе теряются стектрейсы и участки трассировки |
| свои `isString`, `isRecord` | модуль `Predicate` | в пакете есть готовые и композируемые |
| ручной парсинг ответа | `Schema` | иначе валидация расходится с типом |
| Effect в переменной как кеш результата | запускать заново или кешировать явно | Effect это описание, а не результат |
| незакрытый канал `R` в сигнатуре наружу | разрядить слоями до запуска | оставленный `R` это незакрытая зависимость, а не мелкая типовая ошибка |

## Ссылки

- Исходники в `node_modules/effect/src`: в третьей версии это точнее любой документации, потому что документация в сети уже описывает четвёртую
