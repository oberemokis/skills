# Go: меньше повторов

> Вернуться к [golang](SKILL.md). Правила про поток управления и ошибки в [SKILL.md](SKILL.md), тесты в [TESTING.md](TESTING.md).

Go многословен по замыслу: поток управления и ошибки видны в каждой строке. Повторы убираются там, где стандартная библиотека или генератор уже решили задачу. Абстракция, которая прячет поток управления, сюда не относится.

### Стандартные хелперы вместо ручных циклов

Проверки на вхождение, значения по умолчанию, разбор строк и склейка ошибок есть в стандартной библиотеке. `slices` и `cmp` появились в 1.21, `strings.Cut` в 1.18, `errors.Join` в 1.20, `cmp.Or` в 1.22.

```go
// хорошо
if slices.Contains(roles, RoleAdmin) {
	return true
}
```

```go
// плохо: пять строк ради проверки на вхождение
found := false
for _, role := range roles {
	if role == RoleAdmin {
		found = true
		break
	}
}
if found {
	return true
}
```

`cmp.Or` возвращает первое ненулевое значение. Его берут там, где нулевое значение означает «не задано».

```go
// хорошо: первое ненулевое значение, без цепочки if
timeout := cmp.Or(cfg.Timeout, defaultTimeout)
```

```go
// плохо
timeout := defaultTimeout
if cfg.Timeout != 0 {
	timeout = cfg.Timeout
}
```

```go
// хорошо: разбор без индексов и проверки длины
key, value, found := strings.Cut(line, "=")
```

```go
// плохо: индексы и проверка длины закрывают то, что Cut делает сам
parts := strings.SplitN(line, "=", 2)
if len(parts) != 2 {
	return ErrBadLine
}
```

```go
// хорошо: nil-ошибки отбрасываются сами, возвращается nil, если ошибок не было
return errors.Join(a.Close(), b.Close())
```

```go
// плохо: ручная склейка, вторая ошибка легко теряется при правке
return fmt.Errorf("close: %v; %v", a.Close(), b.Close())
```

### Итераторы вместо колбэков и срезов целиком

С 1.23 функция возвращает `iter.Seq[T]`, и вызывающий читает её обычным `for range`. Обход, пагинация и фильтрация не строят промежуточный срез и не требуют колбэка.

```go
// хорошо: вызывающий сам решает, сколько читать и когда остановиться
func (c *Cart) Items() iter.Seq[Item] {
	return func(yield func(Item) bool) {
		for _, line := range c.lines {
			if !yield(line.Item) {
				return
			}
		}
	}
}

for item := range cart.Items() {
	total += item.Price
}
```

```go
// плохо: колбэк не умеет прерваться, остаётся только флаг или паника
func (c *Cart) EachItem(fn func(Item)) {
	for _, line := range c.lines {
		fn(line.Item)
	}
}
```

Ключи карты в отсортированном виде берутся одной строкой: `slices.Sorted(maps.Keys(m))`, тоже с 1.23.

### Маппинг убирают, если формы совпадают

Функция, которая копирует поля один в один, становится слоем, который отстаёт при первом изменении модели. Маппинг оставляют, когда граница отличается: другие имена, типы, набор полей или скрытые поля.

```go
// хорошо: форма совпадает с границей, отдаём модель как есть
return json.NewEncoder(w).Encode(order)
```

```go
// плохо: слой копирует одинаковые поля и молча отстанет, когда модель вырастет
func toOrderDTO(order Order) OrderDTO {
	return OrderDTO{ID: order.ID, Total: order.Total, Status: order.Status}
}
```

### Функциональные опции только для публичного конструктора

Функции-опции нужны, когда публичный конструктор принимает много необязательных параметров. Внутри пакета и для остального хватает структуры: её поля видны на вызове и не требуют отдельного типа на каждую опцию.

```go
// хорошо: внутренняя конфигурация одной структурой
type clientConfig struct {
	timeout time.Duration
	retries int
}

func newClient(config clientConfig) *client {
	return &client{timeout: config.timeout, retries: config.retries}
}
```

```go
// плохо: отдельная функция-опция на каждое поле внутреннего типа
type option func(*client)

func withTimeout(timeout time.Duration) option {
	return func(c *client) { c.timeout = timeout }
}
```

### Кодогенерация вместо повтора руками

Строковые имена перечислений, моки интерфейсов и другой однотипный код пишет генератор, а не человек. Директива `go generate` держит его рядом с источником, и при новом значении перегенерировать достаточно одной командой.

```go
// хорошо: директива рядом с типом, String() генерируется утилитой stringer
//go:generate stringer -type=Status

type Status int

const (
	Draft Status = iota
	Paid
)
```

```go
// плохо: таблица имён, которую при каждом новом значении правят руками и забывают
func (s Status) String() string {
	switch s {
	case Draft:
		return "draft"
	case Paid:
		return "paid"
	}
	return "unknown"
}
```

### Хелпер появляется на третьем повторении

Хелпер ради одной строки переносит шум из вызова в объявление. Два похожих места остаются отдельными, и общая функция появляется, когда повторений стало три.

```go
// хорошо: два похожих места живут отдельно, пока не появилось третье
func renderOrder(order *Order) string { ... }
func renderInvoice(invoice *Invoice) string { ... }
```

```go
// плохо: обобщено на втором повторении, и опции растут с каждым новым случаем
func render[T Renderable](item T, options renderOptions) string { ... }
```
