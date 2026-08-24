---
name: typescript
description: Стиль типизации: где доверять выводу и где аннотировать, satisfies вместо as, дискриминированные объединения, unknown вместо any, предикаты, объединения литералов вместо enum, когда generics лишние. Читать при написании любого кода на TypeScript, до первой строки.
---

# TypeScript

> Точка входа: [skills/core](../../core/SKILL.md). Если core ещё не прочитан, прочитать его до этого скилла.

Скилл про стиль, а не про версию. Все правила ниже одинаково верны на пятой, шестой и седьмой версии, потому что касаются того, как описывать данные, а не того, как называется ключ в конфиге.

## Когда применять

- пишешь или правишь любой `.ts`, типы в `.vue`, публичный интерфейс модуля
- решаешь, аннотировать или довериться выводу
- появилось желание написать `as` или `any`

## Когда НЕ применять

- реактивность и макросы компонентов: это `vue`
- конфигурация сборки и тестов: это `vite` и `vitest`
- ключи `tsconfig.json` и поведение компилятора между мажорами: сверяй по установленной версии, здесь этого нет намеренно

## Соглашения проекта

Выведены из существующего кода и из `.rules`. Следуй им, даже если привычка подсказывает иначе.

- двойные кавычки и точки с запятой
- обработчики и утилиты объявляются как `function name()`, не как `const name = () => {}`
- `interface` для публичного интерфейса модуля, `type` для композиций и утилитных типов
- экспорты только именованные, `export default` не используется
- типы импортируются через `import type`
- у экспортируемой функции возвращаемый тип объявлен явно
- входные массивы помечаются `readonly`
- ключи справочников выводятся из типа пропса, а не переписываются рядом
- один публичный экспорт на файл, кроме индексов-баррелей
- файл длиннее 250 строк делится
- больше двух аргументов у функции означает объект с именованными полями
- флаг-булеан в аргументах не передаётся: он значит, что функция делает две разные вещи

## Правила

### Разделяй код пустыми строками на смысловые блоки

Слипшийся код читается как один шаг, даже когда в нём три. Пустая строка это самый дешёвый способ показать границу.

```ts
// хорошо
function submitOrder(form: OrderForm) {
  const errors = validate(form)
  if (errors.length > 0) return { status: "invalid", errors }

  const payload = toOrderDto(form)
  const order = await createOrder(payload)

  trackConversion(order.id)
  return { status: "created", order }
}
```

```ts
// плохо: три разных дела в одном слитном куске
function submitOrder(form: OrderForm) {
  const errors = validate(form)
  if (errors.length > 0) return { status: "invalid", errors }
  const payload = toOrderDto(form)
  const order = await createOrder(payload)
  trackConversion(order.id)
  return { status: "created", order }
}
```

Отделяй проверки от работы, работу от побочных эффектов, объявления от использования. Внутри блока пустых строк не надо: если хочется разделить блок ещё раз, это два блока.

Правило касается шагов, а не строк. Определение типа, литерал объекта, объект конфигурации и таблица случаев это один шаг, и разрывать их пустыми строками не надо.

```ts
// хорошо: это одно целое, разделять нечего
type Order = {
  id: string
  items: readonly Item[]
  paidAt: string | null
}
```

То же в теле функции: объявления, идущие подряд и относящиеся к одному шагу, живут вместе, а пустая строка отделяет их от следующего шага.

### Полные имена, ни одной однобуквенной

Однобуквенных переменных, параметров и полей не бывает, включая аргументы колбэков и переменные циклов. `uiStore`, а не `ui`. `post`, а не `p`. `userId`, а не `id`, когда рядом есть другие идентификаторы.

```ts
// хорошо
const activePosts = posts.filter((post) => post.isPublished)
for (const order of orders) applyDiscount(order)
```

```ts
// плохо
const a = posts.filter((p) => p.isPublished)
for (const o of orders) applyDiscount(o)
```

Имя функции описывает, что она делает, а не что у неё внутри: `filterPostsByUser`, `toggleUserSelection`.

Префиксы задают, чего ждать от вызова:

| Префикс | Что делает |
| --- | --- |
| `is`, `has`, `can` | возвращает boolean |
| `handle` | обрабатывает событие |
| `on` | реагирует на изменение |
| `to`, `from`, `as` | конвертирует данные |
| `fetch`, `load` | ходит наружу |
| `make`, `create` | фабрика |
| `ensure` | проверяет и бросает |
| `with` | обёртка |
| `build`, `parse`, `format` | строит, разбирает, форматирует |

Суффиксы задают роль сущности: `*Props` и `*Emits` для компонента, `*Store`, `*Service`, `*Repository`, `*Schema`, `*Error`, `*Dto`, `*Id`.

### Доверяй выводу внутри, аннотируй границы

Внутри функции вывод точнее ручной аннотации и не расходится с кодом. На границе модуля тип это контракт, и он объявляется явно.

```ts
// хорошо
export function parseOrder(raw: unknown): Order {
  const items = [] // вывод справится
  return { id: "", items }
}
```

```ts
// плохо: аннотация внутри дублирует вывод и рассинхронизируется при правке
const items: Item[] = []
const total: number = items.length
```

### satisfies вместо as

`as` выключает проверку и врёт компилятору. `satisfies` проверяет соответствие и при этом сохраняет узкий вывод.

```ts
// хорошо: ключи остаются литералами, лишнее поле поймается
const routes = {
  home: "/",
  order: "/orders/:id",
} satisfies Record<string, string>
```

```ts
// плохо: тип расширился до Record<string, string>, литералы потеряны
const routes = {
  home: "/",
  order: "/orders/:id",
} as Record<string, string>
```

`as` оправдан там, где ты знаешь больше компилятора и не можешь это выразить: сужение после внешней проверки, работа с DOM. В остальных случаях это способ спрятать несоответствие.

### Тип выводи из данных, а не дублируй рядом

Продублированное объединение расходится с источником при первой же правке.

```ts
// хорошо: ключи справочника связаны с типом пропса
const props = defineProps<{ variant?: "solid" | "ghost" | "light" }>()
const variantClasses: Record<NonNullable<typeof props.variant>, string> = {
  solid: "...",
  ghost: "...",
  light: "...",
}
```

```ts
// плохо: добавили вариант в пропсы, справочник промолчал
const variantClasses: Record<string, string> = { solid: "...", ghost: "..." }
```

### На входе unknown, сужение предикатом

Данные из сети, из хранилища, из параметров адреса это `unknown`, а не `any`. Разница в том, что `unknown` заставляет проверить, а `any` разрешает всё и молчит.

```ts
// хорошо
function isOrder(value: unknown): value is Order {
  return typeof value === "object" && value !== null && "id" in value
}

const data: unknown = await res.json()
if (!isOrder(data)) throw new Error("неожиданный ответ")
```

```ts
// плохо: ошибка всплывёт в другом месте и без следа
const data: any = await res.json()
renderOrder(data.id)
```

Предикат в фильтре снимает `null` из типа, а не только из массива:

```ts
const elements = ids
  .map((id) => document.getElementById(id))
  .filter((el): el is HTMLElement => el !== null)
```

Предикат обязан проверять то, что обещает. Врущий предикат хуже `as`: ошибка спрячется за именем, которое утверждает, что всё безопасно, и найти её будет негде.

```ts
// плохо: имя обещает проверку, тело её не делает
function isOrder(value: unknown): value is Order {
  return typeof value === "object"
}
```

Способы сужения по убыванию надёжности: тег объединения, оператор `in`, `typeof` и `instanceof`, свой предикат, и только потом `as`. Спускайся по списку, а не начинай с конца.

### Сузь сигнатуру вместо каста

Каст часто нужен не потому, что тип неверен, а потому, что функция просит больше, чем ей нужно. Возьми в параметры то, что реально используешь, и приведение исчезнет само.

```ts
// хорошо: функции нужен идентификатор, она его и просит
function orderUrl(id: string) {
  return `/orders/${id}`
}
orderUrl(order.id)
```

```ts
// плохо: просит весь заказ, поэтому на неполных данных требуется каст
function orderUrl(order: Order) {
  return `/orders/${order.id}`
}
orderUrl({ id } as Order)
```

Если каста избежать нельзя, рядом должно стоять объяснение, почему он безопасен. Каст без внятного обоснования это не приведение типа, а спрятанная ошибка.

### Не усиливай тип раньше времени

Обратная сторона строгой типизации. Держи самый простой тип, пока все операции над ним остаются полными. Усиливай только там, где слабый тип вынуждает написать `!`, каст или ветку «такого не бывает».

```ts
// хорошо: обычный массив, все операции над ним корректны
function total(items: readonly Item[]) {
  return items.reduce((sum, item) => sum + item.price, 0)
}
```

```ts
// плохо: непустой массив введён без нужды, и теперь его надо конструировать
function total(items: readonly [Item, ...Item[]]) {
  return items.reduce((sum, item) => sum + item.price, 0)
}
```

Признак того, что тип наоборот слишком слаб: чтобы понять баг, приходится спрашивать «а такая комбинация вообще возможна». Тогда усиливай.

### Объединение литералов вместо enum

Объединение существует только в типах, ничего не добавляет в сборку и совместимо со строками из внешнего мира.

```ts
// хорошо
type Status = "draft" | "paid" | "shipped"
const STATUSES = ["draft", "paid", "shipped"] as const
```

```ts
// плохо: enum это рантайм-объект, и его значения несовместимы со строками
enum Status {
  Draft = "draft",
  Paid = "paid",
}
```

### Дискриминированное объединение вместо флагов

Опциональные поля и булевы флаги допускают состояния, которых в реальности не бывает. Объединение с тегом делает невозможное невыразимым.

```ts
// хорошо: недостижимых комбинаций не существует
type Request =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; data: Order }
```

```ts
// плохо: разрешает loading вместе с error и data одновременно
type Request = {
  loading: boolean
  error?: string
  data?: Order
}
```

Разбирай такое объединение через `switch` по тегу с проверкой на `never` в `default`. Тогда добавленный вариант ломает сборку, а не тихо проваливается мимо всех ветвей.

```ts
// хорошо
function assertNever(value: never): never {
  throw new Error(`неожиданный вариант: ${JSON.stringify(value)}`)
}

switch (request.status) {
  case "loading":
    return renderSpinner()
  case "error":
    return renderError(request.message)
  case "done":
    return renderOrder(request.data)
  default:
    return assertNever(request)
}
```

```ts
// плохо: новый вариант молча вернёт undefined
if (request.status === "loading") return renderSpinner()
if (request.status === "error") return renderError(request.message)
```

Тег обязан быть литеральным типом: строковый литерал, числовой литерал, `true` или `false`. По вычисляемому значению сужение не работает.

### Generics только когда есть связь между входом и выходом

Параметр типа оправдан, если он связывает аргумент с результатом. Если он появляется в сигнатуре один раз, это `unknown` с лишним шумом.

```ts
// хорошо: тип результата зависит от аргумента
function first<T>(items: readonly T[]): T | undefined {
  return items[0]
}
```

```ts
// плохо: T встречается однажды, связи нет
function log<T>(value: T): void {
  console.log(value)
}
```

Хуже всего параметр типа, который встречается только в возвращаемом значении: это `as` без слова `as`. Вызывающий назначает тип, компилятор ничего не проверяет.

```ts
// плохо: parseYaml<Order>(text) вернёт Order независимо от содержимого
declare function parseYaml<T>(input: string): T
```

Два параметра типа это уже много, три означают, что функция делает слишком многое.

### readonly на входных данных

Функция, которая не меняет аргумент, объявляет это в типе. Тогда попытка мутации ловится компилятором, а вызывающему видно, что копия не нужна.

```ts
// хорошо
function total(items: readonly Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}
```

```ts
// плохо: сигнатура разрешает мутацию, поэтому вызывающий обязан защищаться копией
function total(items: Item[]): number {
  items.sort((left, right) => left.price - right.price) // и это скомпилируется
  return items.reduce((sum, item) => sum + item.price, 0)
}
total([...order.items])
```

`readonly` при этом поверхностный: он запрещает переприсваивание, но не замораживает вложенные объекты. Для настоящей неизменяемости нужны либо копии, либо `readonly` на каждом уровне.

### Точно описывай отсутствие значения

Три разных случая, которые часто пишут одинаково.

```ts
// хорошо
type Order = {
  comment?: string // ключа может не быть вовсе
  discount: number | undefined // ключ есть всегда, значения может не быть
  paidAt: string | null // сервер присылает явный null
}
```

```ts
// плохо: три разных случая описаны одинаково, и проверить их нечем
type Order = {
  comment?: string
  discount?: number
  paidAt?: string
}
```

Смешение этих форм ломает и проверки, и сериализацию: `"comment" in order` и `order.comment === undefined` перестают быть одним и тем же. `null` от сервера нормализуй на границе, внутри слоя держи одну форму.

## Привязано к версии

Ничего. Все правила выше про то, как описывать данные, и от мажора не зависят.

Версионное в TypeScript это ключи `tsconfig.json`, флаги строгости и поведение вывода в краевых случаях. Этого здесь нет намеренно: такие вещи проверяются по установленной версии, а не по скиллу, иначе скилл начнёт врать при первом обновлении.

## Антипаттерны

Сгруппированы по теме. То, что уже показано в «Правилах», здесь не повторяется.

### Приведения и подавление проверок

```ts
// плохо
const order = data as unknown as Order // двойное приведение = тип неверен
const name = user!.name // ! это as в одну букву
// @ts-ignore
brokenLibraryCall() // молчит и после того, как ошибку в библиотеке исправили
if (value != null) use(value) // value никогда не null, ветка мертва
```

```ts
// хорошо
if (!isOrder(data)) throw new Error("неожиданный ответ")
const name = user?.name ?? "без имени"
// @ts-expect-error библиотека объявляет число вместо строки
brokenLibraryCall() // когда исправят, эта строка сама станет ошибкой
if (value !== undefined) use(value)
```

`@ts-expect-error` тем и хорош, что перестаёт быть нужным заметно: как только подавляемая ошибка исчезает, комментарий сам превращается в ошибку.

### Типы, которые молчат

```ts
// плохо
type Row = { status: string } & { status: number } // молча стал never
const rows: Row[] = [] // и никакое значение сюда не подойдёт

function copy(items: Item[]) {
  items.sort(byPrice) // мутирует чужой массив, вызывающий этого не ждёт
  return items
}

type Deep = { readonly config: { theme: string } }
declare const deep: Deep
deep.config.theme = "dark" // скомпилируется, readonly поверхностный
```

```ts
// хорошо
type Row = { kind: "draft"; status: string } | { kind: "sent"; status: number }

function sorted(items: readonly Item[]): Item[] {
  return [...items].sort(byPrice)
}

type Deep = { readonly config: { readonly theme: string } }
```

### Поток управления

```ts
// плохо
function priceFor(order: Order) {
  if (order.isPaid) {
    if (order.discount) {
      return order.total - order.discount
    } else {
      return order.total
    }
  }
  return 0
}

orders.forEach(async (order) => {
  await send(order) // цикл не подождёт, ошибки потеряются
})
```

```ts
// хорошо
function priceFor(order: Order) {
  if (!order.isPaid) return 0
  if (!order.discount) return order.total

  return order.total - order.discount
}

for (const order of orders) {
  await send(order)
}
```

Ранний возврат для исключительных случаев, `else` после `return` не нужен, а `for...of` в отличие от `forEach` допускает `await`, `break` и `continue`.

### Значения без имени

```ts
// плохо
if (attempts > 3) giveUp() // почему три
setTimeout(retry, 5000) // почему пять секунд
if (user.role === "admin") allow() // строка размножится по файлам
```

```ts
// хорошо
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 5000
const ROLE_ADMIN = "admin"

if (attempts > MAX_ATTEMPTS) giveUp()
setTimeout(retry, RETRY_DELAY_MS)
if (user.role === ROLE_ADMIN) allow()
```

Исключение только `0`, `1` и `-1` в тривиальной арифметике и работе с индексами.

### Абстракция раньше времени

```ts
// плохо: второе повторение, а уже обобщили
function renderEntity<T extends { id: string }>(
  entity: T,
  options: RenderOptions<T>,
) {}
```

```ts
// хорошо: два похожих места живут отдельно, пока не появилось третье
function renderOrder(order: Order) {}
function renderInvoice(invoice: Invoice) {}
```

Правило трёх: обобщать на третьем повторении. До него дублирование дешевле, чем неверная абстракция, которую потом придётся разбирать.

### Остальное коротко

| Не так | Так | Почему |
| --- | --- | --- |
| `export default` | именованный экспорт | имя при импорте перестаёт быть произвольным |
| `interface` и `type` вперемешку для одного и того же | `interface` для публичного интерфейса, `type` для композиций | смешение читается как разница в смысле, которой нет |
| смешение `null` и `undefined` в одном слое | одна форма на слой, `null` нормализуется на границе | иначе каждая проверка должна учитывать оба случая |
| однобуквенное имя в колбэке или цикле | полное имя сущности | читающему приходится держать в голове, что это |
| файл длиннее 250 строк | разделить | дальше он перестаёт читаться целиком |
| больше двух аргументов | объект с именованными полями | на вызове не видно, что куда передаётся |
| булеан-флаг в аргументах | две функции или строковый вариант | флаг означает, что функция делает два разных дела |
