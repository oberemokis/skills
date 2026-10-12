---
name: golang
description: Стиль Go: ошибки с %w и errors.Is, маленькие интерфейсы у потребителя, context первым аргументом, горутины с понятным концом, нулевое значение, nil-срезы в JSON, имена без Get и с аббревиатурами, пустые строки между шагами, одна задача на функцию, ранний возврат вместо вложенности, меньше шаблонного кода: стандартные хелперы вместо циклов, итераторы, кодогенерация, обёртка ошибки на границе пакета. Читать при написании или правке любого .go файла и go.mod, до первой строки.
---

# Go

> Точка входа: [skills/core](../../core/SKILL.md). Если core ещё не прочитан, прочитать его до этого скилла.

Версия: Go 1.27.2, актуальный stable на дату написания. Правила про поведение переживают минорные релизы, всё привязанное к конкретной версии вынесено в «Привязано к версии».

## Когда применять

- пишешь или правишь `.go` файлы и `go.mod`
- пишешь или правишь `_test.go`: сначала [TESTING.md](TESTING.md), там табличные тесты, `t.Helper`, `t.Cleanup`, `t.Setenv`, подмена через интерфейс потребителя
- решаешь, как вернуть ошибку, где объявить интерфейс, как запустить горутину
- появилось желание написать `panic`, пакет `util` или параметр `any`

## Когда НЕ применять

- что проверять и что подменять: это `test`, а Go-специфика тестов лежит в [TESTING.md](TESTING.md)
- структура модулей и слоёв: в плагине такого скилла нет, работай без него и скажи об этом

## Соглашения

Следуй им, даже если привычка подсказывает иначе.

- форматирование только через `gofmt`, спора о стиле не возникает
- имя пакета короткое, в нижнем регистре, без подчёркиваний, и не повторяется в именах экспорта: `order.Service`, а не `order.OrderService`
- аббревиатуры пишутся целиком в одном регистре: `userID`, `URL`, `HTTPClient`
- геттеры без `Get`: `order.Total()`, а не `order.GetTotal()`
- приёмник короткий, по первой букве типа в нижнем регистре: `func (o *Order) Total()`. Это идиома языка, однобуквенный запрет из `typescript` сюда не переносится
- пакеты `util`, `common`, `helpers` не создаются: имя пакета называет то, что в нём есть

## Правила

### Ошибка несёт контекст и сохраняет цепочку

Контекст добавляется там, где появляется новая информация: имя операции, ключ, граница пакета. Внутри пакета ошибку возвращают как есть, иначе каждая строка получает свою обёртку, и одна причина повторяется в логе несколько раз. `%w` сохраняет цепочку для `errors.Is` и `errors.As`, `%v` её обрывает.

```go
// хорошо
row, err := s.db.QueryRowContext(ctx, query, id)
if err != nil {
	return nil, fmt.Errorf("load order %s: %w", id, err)
}
```

```go
// плохо: вызывающий не найдёт sql.ErrNoRows, цепочка оборвана
return nil, fmt.Errorf("load order %s: %v", id, err)
```

Проверка на конкретную ошибку идёт через `errors.Is`, а не через текст сообщения:

```go
// хорошо
if errors.Is(err, sql.ErrNoRows) {
	return nil, ErrOrderNotFound
}
```

```go
// плохо: сломается при первой правке текста ошибки
if err.Error() == "sql: no rows in result set" {
```

### Ошибка либо обрабатывается здесь, либо возвращается

Логировать и возвращать одновременно значит получить две записи об одном сбое, потому что верхний уровень залогирует её ещё раз.

```go
// хорошо
if err != nil {
	return fmt.Errorf("charge card: %w", err)
}
```

```go
// плохо: запись в лог и возврат одной и той же ошибки
if err != nil {
	log.Println(err)
	return err
}
```

### Интерфейс маленький и объявлен там, где нужен

Интерфейс описывает то, что нужно потребителю, а не то, что умеет реализация. Один метод на потребителя лучше полного репозитория.

```go
// хорошо: сервису нужно только чтение, интерфейс живёт в его пакете
type orderReader interface {
	Order(ctx context.Context, id string) (*Order, error)
}

type Service struct {
	orders orderReader
}
```

```go
// плохо: большой интерфейс рядом с единственной реализацией
type OrderRepository interface {
	Order(ctx context.Context, id string) (*Order, error)
	Save(ctx context.Context, order *Order) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context) ([]*Order, error)
}
```

Интерфейс с одной реализацией и одним потребителем не нужен: тип используется напрямую. Функции возвращают конкретный тип, иначе вызывающий работает с урезанным API без причины.

### context первым аргументом и не хранится в структуре

Контекст живёт ровно один вызов. Поле структуры переживает запрос, и отмена, пришедшая из вызова, до операции уже не дойдёт.

```go
// хорошо
func (c *Client) Fetch(ctx context.Context, url string) ([]byte, error) {
```

```go
// плохо: отмена запроса не дойдёт до сохранённого контекста
type Client struct {
	ctx context.Context
}
```

Nil вместо контекста не передаётся никогда. Если отмены нет, на верхнем уровне пишется `context.Background()`.

### Горутина имеет конец и того, кто её ждёт

Горутина без способа остановиться и без ожидания утекает, и ошибка в ней не попадает к вызывающему. Ожидание через `sync.WaitGroup`, выход через `ctx.Done()`.

```go
// хорошо: запись не повиснет, если вызывающий ушёл по отмене
go func() {
	select {
	case results <- compute():
	case <-ctx.Done():
	}
}()
```

```go
// плохо: при отмене отправка висит навсегда
go func() {
	results <- compute()
}()
```

Канал закрывает тот, кто в него пишет, и только один раз. Закрытие из получателя или двойное закрытие паникуют.

### Нулевое значение работает без конструктора

Тип, у которого `var x T` уже пригоден, не требует функции `New`. Если состояние нужно создать, это делается лениво внутри метода.

```go
// хорошо: нулевой Cache готов к записи
func (c *Cache) Set(key string, value Item) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.items == nil {
		c.items = make(map[string]Item)
	}
	c.items[key] = value
}
```

```go
// плохо: запись в nil-карту паникует
func (c *Cache) Set(key string, value Item) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = value
}
```

### Один тип, один вид приёмника

Если у типа хотя бы один метод с указательным приёмником, все методы берут указатель. Смешение делит набор методов: значение `Order` не реализует интерфейс с `Save`, а `*Order` реализует оба, и тип ведёт себя по-разному в зависимости от того, как его передали.

```go
// хорошо: набор методов у *Order един
func (o *Order) Total() int { return o.amount }
func (o *Order) Save() error { ... }
```

```go
// плохо: Order и *Order имеют разные наборы методов
func (o Order) Total() int { return o.amount }
func (o *Order) Save() error { ... }
```

### Ошибка закрытия при записи не теряется

`defer f.Close()` проглатывает ошибку, которую файловая система возвращает именно при закрытии: там сбрасывается буфер.

```go
// хорошо: ошибка закрытия попадает в результат, если запись прошла
func writeFile(path string, data []byte) (err error) {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() {
		closeErr := f.Close()
		if err == nil {
			err = closeErr
		}
	}()

	_, err = f.Write(data)
	return err
}
```

```go
// плохо: запись может не дойти до диска, и никто об этом не узнает
func writeFile(path string, data []byte) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.Write(data)
	return err
}
```

### panic только для ошибок программиста

Отсутствующий файл конфигурации это ожидаемая ошибка окружения, её возвращают. `panic` оставлен для состояния, которое не должно случиться никогда: нарушенный инвариант, невозможный вариант.

```go
// плохо
cfg, err := load(path)
if err != nil {
	panic(err)
}
```

```go
// хорошо
cfg, err := load(path)
if err != nil {
	return nil, fmt.Errorf("load config: %w", err)
}
```

### Пустая строка отделяет шаги

Код из нескольких шагов читается как один шаг, пока между ними нет границы. Пустая строка это самый дешёвый способ её провести. Внутри шага пустых строк нет, а объявление структуры или таблица значений это один шаг целиком.

```go
// хорошо: проверка, работа и побочный эффект разделены
errs := validate(form)
if len(errs) > 0 {
	return nil, ErrInvalidOrder
}

payload := toOrderPayload(form)
order, err := s.orders.Create(ctx, payload)
if err != nil {
	return nil, fmt.Errorf("create order: %w", err)
}

s.tracker.Conversion(order.ID)
return order, nil
```

```go
// плохо: три разных дела слиты в один кусок, где границ не видно
errs := validate(form)
if len(errs) > 0 {
	return nil, ErrInvalidOrder
}
payload := toOrderPayload(form)
order, err := s.orders.Create(ctx, payload)
if err != nil {
	return nil, fmt.Errorf("create order: %w", err)
}
s.tracker.Conversion(order.ID)
return order, nil
```

### Функция делает одну задачу

Функция либо проверяет, либо строит, либо сохраняет, но не всё сразу. Признак перегрузки: в названии есть «и», или описание требует слова «затем». Тогда функция распадается на именованные шаги, а верхняя только вызывает их по порядку.

```go
// хорошо: каждая функция делает одно, верхняя читается как список шагов
func (s *Service) SubmitOrder(ctx context.Context, form OrderForm) (*Order, error) {
	if err := validateOrder(form); err != nil {
		return nil, err
	}

	order, err := s.createOrder(ctx, form)
	if err != nil {
		return nil, err
	}

	s.tracker.Conversion(order.ID)
	return order, nil
}
```

```go
// плохо: проверка, сборка, запись и метрика в одном теле, и название выдаёт это словом «And»
func (s *Service) SubmitAndTrackOrder(ctx context.Context, form OrderForm) (*Order, error) {
	if form.Quantity <= 0 {
		return nil, ErrInvalidOrder
	}
	payload := toOrderPayload(form)
	order, err := s.orders.Create(ctx, payload)
	if err != nil {
		return nil, err
	}
	s.tracker.Conversion(order.ID)
	return order, nil
}
```

Функция, которая просто вызывает три других, не нарушает правило. Нарушено оно там, где в одном теле смешаны решение и исполнение.

### Guard-проверки и ранний возврат

Ошибки и крайние случаи проверяются в начале функции и возвращаются сразу. Основной путь остаётся без отступа, и читатель видит его первым. Вложенность глубже двух уровней это сигнал вернуться раньше или вынести ветку в функцию.

```go
// хорошо: каждая ошибка уходит сразу, успешный путь идёт одной линией
func load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg, err := parse(data)
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	return cfg, nil
}
```

```go
// плохо: успех вложен в ошибку, и каждый уровень приходится держать в голове
func load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		cfg, parseErr := parse(data)
		if parseErr == nil {
			return cfg, nil
		} else {
			return nil, parseErr
		}
	} else {
		return nil, err
	}
}
```

### Внутри пакета ошибка возвращается как есть

Обёртка нужна на границе: в публичном методе, на входе в другой пакет, там, где есть имя операции или ключ. Промежуточные функции того же пакета возвращают ошибку без изменений.

```go
// хорошо: контекст добавляет публичный метод, внутренний шаг возвращает ошибку как есть
func (s *Store) Order(ctx context.Context, id string) (*Order, error) {
	order, err := s.findOrder(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("load order %s: %w", id, err)
	}

	return order, nil
}

func (s *Store) findOrder(ctx context.Context, id string) (*Order, error) {
	row, err := s.db.QueryRowContext(ctx, query, id)
	if err != nil {
		return nil, err
	}
	...
}
```

```go
// плохо: одна ошибка обёрнута на каждом уровне, в логе её причина повторяется
func (s *Store) findOrder(ctx context.Context, id string) (*Order, error) {
	row, err := s.db.QueryRowContext(ctx, query, id)
	if err != nil {
		return nil, fmt.Errorf("query order: %w", err)
	}
	...
}
```

## Повторы

Стандартные хелперы, итераторы, маппинг, опции, кодогенерация и правило третьего повторения вынесены в [BOILERPLATE.md](BOILERPLATE.md). Читать его, когда код выглядит многословно или повторяется.

## Привязано к версии

Правила выше от релиза не зависят. Ниже то, что меняет привычный код. Сверяйся с директивой `go` в `go.mod` проекта: конструкцию новее неё компилятор не пропустит, а старая версия этого скилла не отменяет.

- до 1.22 переменная цикла была одна на весь цикл, и замыкание в горутине видело последнее значение. С 1.22 каждая итерация получает свою переменную, и `v := v` перед замыканием больше не пишут.
- с 1.21 встроены `min`, `max` и `clear`, а `log/slog` входит в стандартную библиотеку.
- с 1.23 появились пакет `iter` и `range` по функции-итератору. `maps.Keys` и `slices.Sorted` возвращают итераторы, поэтому `slices.Sorted(maps.Keys(m))` работает без промежуточного среза.
- с 1.24 инструменты проекта объявляются директивой `tool` в `go.mod`, а не пустым импортом в `tools.go`. Тег `omitzero` в JSON скрывает нулевое значение структуры, например `time.Time`, а `omitempty` его не скрывает.
- с 1.25 `sync.WaitGroup.Go(f)` запускает горутину и сам вызывает `Done`.
- с 1.26 встроенный `new` принимает выражение: `new(yearsSince(born))` даёт указатель на готовое значение без временной переменной.
- с 1.27 методы могут объявлять собственные параметры типа. У методов интерфейса параметров типа по-прежнему нет.

## Антипаттерны

Ошибки, время и горутины, имена и пакеты, типы, nil-срезы собраны в [ANTIPATTERNS.md](ANTIPATTERNS.md). Всё, что уже показано в правилах, там не повторяется.

## Ссылки

- [Effective Go](https://go.dev/doc/effective_go): базовые идиомы, здесь не пересказаны
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments): то, что ревьюеры проверяют первым
- [Release notes](https://go.dev/doc/devel/release): при переходе на новый минор сверяй раздел «Привязано к версии» с ними
