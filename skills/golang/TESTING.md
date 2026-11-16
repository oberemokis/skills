# Go: тесты

> Вернуться к [golang](SKILL.md). Что проверять, что подменять и какой тип теста брать: [skills/test](../../test/SKILL.md). Здесь только то, что специфично для Go и его `testing`.

## Файл и пакет

Тест лежит рядом с кодом в файле `*_test.go`. По умолчанию пакет теста внешний, `package order_test`: тогда он видит только публичный интерфейс и не может проверить приватное поле. Внутренний пакет `package order` берут, только когда проверяется то, что без приватного доступа не проверить.

```go
// хорошо: тест видит только то, что видит вызывающий
package order_test

import "example.com/shop/order"
```

```go
// плохо: тест залез в приватное поле и будет ломаться при каждом рефакторинге
package order

func TestTotal(t *testing.T) {
	o := &Order{amount: 100}
	if o.amount != 100 { ... }
}
```

Фикстуры кладут в каталог `testdata/`. Go его не собирает как пакет, поэтому файлы там не попадают в сборку.

## Табличные тесты через t.Run

Случаи перечисляются в таблице, каждый запускается через `t.Run` с именем. Короткое имя `tc` в цикле таблицы здесь идиома, длинное `testCase` ничего не добавляет.

```go
// хорошо: провал показывает, какой случай упал
func TestParseAmount(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  int
	}{
		{name: "целое", input: "12", want: 12},
		{name: "с копейками", input: "12.50", want: 1250},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseAmount(tc.input)
			if err != nil {
				t.Fatalf("ParseAmount(%q): %v", tc.input, err)
			}
			if got != tc.want {
				t.Errorf("ParseAmount(%q) = %d, want %d", tc.input, got, tc.want)
			}
		})
	}
}
```

```go
// плохо: при провале непонятно, какой вход сломал функцию
for _, tc := range tests {
	got, _ := ParseAmount(tc.input)
	if got != tc.want {
		t.Error("wrong amount")
	}
}
```

Сообщение об ошибке пишется в виде `Функция(вход) = получили, want ожидали`. Тогда по логу видно вход, выход и ожидание без открытия файла.

## Fatal или Error

`t.Fatal` и `t.Fatalf` останавливают тест. Их берут, когда дальнейшие проверки бессмысленны без результата, например после ошибки, которую функция не должна была вернуть. `t.Error` и `t.Errorf` продолжают тест, и за один прогон видно все расхождения.

```go
// хорошо: без результата дальше проверять нечего
got, err := ParseAmount(input)
if err != nil {
	t.Fatalf("ParseAmount(%q): %v", input, err)
}
```

```go
// плохо: при ошибке тест идёт дальше и сравнивает нулевое значение с ожидаемым
got, err := ParseAmount(input)
if err != nil {
	t.Errorf("ParseAmount(%q): %v", input, err)
}
if got != want {
	t.Errorf("ParseAmount(%q) = %d, want %d", input, got, want)
}
```

`t.Fatal` и `t.FailNow` вызываются только из горутины теста. Из другой горутины они останавливают только её, а тест идёт дальше и может проверять результат, которого нет.

## Вспомогательные функции помечают t.Helper

Без `t.Helper()` ошибка указывает на строку внутри вспомогательной функции, а не на место вызова, и непонятно, какой случай упал.

```go
// хорошо: провал указывает на строку теста, которая вызвала helper
func mustOpen(t *testing.T, path string) *os.File {
	t.Helper()

	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	t.Cleanup(func() { file.Close() })
	return file
}
```

```go
// плохо: провал указывает на строку helper, а не на вызов
func mustOpen(t *testing.T, path string) *os.File {
	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	return file
}
```

## Ресурсы очищаются через t.Cleanup и t.TempDir

Временный каталог берётся через `t.TempDir()`, он удаляется сам. Остальное освобождается через `t.Cleanup`, который выполняется в обратном порядке регистрации даже при провале.

```go
// хорошо: каталог удалится сам, сервер закроется при любом исходе
dir := t.TempDir()

srv := httptest.NewServer(handler)
t.Cleanup(srv.Close)
```

```go
// плохо: при провале до defer каталог и сервер остаются
dir, _ := os.MkdirTemp("", "test")
defer os.RemoveAll(dir)
srv := httptest.NewServer(handler)
defer srv.Close()
```

Переменные окружения меняют через `t.Setenv`: значение возвращается после теста. `os.Setenv` без восстановления протекает в следующие тесты.

```go
// хорошо: значение вернётся после теста
t.Setenv("PAYMENT_KEY", "test-key")
```

```go
// плохо: значение протечёт в тесты, которые пойдут после этого
os.Setenv("PAYMENT_KEY", "test-key")
```

## Параллельные тесты

`t.Parallel()` ставят, только когда тест не разделяет состояние с другими. В параллельном тесте и в его родителе нельзя вызывать `t.Setenv` и `t.Chdir`, иначе тест паникует.

```go
// хорошо: независимые случаи идут параллельно
for _, tc := range tests {
	t.Run(tc.name, func(t *testing.T) {
		t.Parallel()

		got := Normalize(tc.input)
		if got != tc.want {
			t.Errorf("Normalize(%q) = %q, want %q", tc.input, got, tc.want)
		}
	})
}
```

```go
// плохо: параллельный тест меняет окружение и паникует
t.Run(tc.name, func(t *testing.T) {
	t.Parallel()
	t.Setenv("LOCALE", tc.locale)
})
```

Копия переменной цикла `tc := tc` больше не нужна с 1.22, см. [SKILL.md](SKILL.md#привязано-к-версии).

## Подмена через интерфейс потребителя

Тот же интерфейс, что и в продакшене, заменяется структурой-заглушкой из тестов. Заглушка описывает ровно нужные методы и ничего не проверяет сама.

```go
// хорошо: заглушка из двух полей, интерфейс объявлен у сервиса
type fakeOrderReader struct {
	order *Order
	err   error
}

func (f fakeOrderReader) Order(ctx context.Context, id string) (*Order, error) {
	return f.order, f.err
}

func TestSubmitOrderReturnsNotFound(t *testing.T) {
	svc := Service{orders: fakeOrderReader{err: ErrOrderNotFound}}

	_, err := svc.Submit(context.Background(), "42")
	if !errors.Is(err, ErrOrderNotFound) {
		t.Errorf("Submit() error = %v, want ErrOrderNotFound", err)
	}
}
```

```go
// плохо: глобальная подмена клиента, которая переживёт тест и сломает параллельные
func TestSubmit(t *testing.T) {
	http.DefaultClient = &http.Client{Transport: stubTransport{}}
}
```

Для HTTP-клиента, который должен говорить по настоящей сети на `localhost`, берут `httptest.NewServer`. Для хендлера, который проверяется напрямую, берут `httptest.NewRecorder`.

## Время

Время в тесте не ждут. Сервис принимает часы извне: поле `now func() time.Time`, которое тест заменяет фиксированным значением. Для таймеров и горутин используют `testing/synctest` с 1.25: внутри `synctest.Test` часы фальшивые и сдвигаются, когда все горутины заблокированы.

```go
// хорошо: задержка проверяется мгновенно
func TestRetryWaitsFiveSeconds(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		start := time.Now()
		waitBeforeRetry()

		if got := time.Since(start); got != 5*time.Second {
			t.Errorf("waited %v, want 5s", got)
		}
	})
}
```

```go
// плохо: тест реально ждёт пять секунд и медленнее всего набора
func TestRetryWaitsFiveSeconds(t *testing.T) {
	start := time.Now()
	waitBeforeRetry()
	if time.Since(start) < 5*time.Second {
		t.Error("too early")
	}
}
```

Контекст для теста берётся через `t.Context()` (с 1.24). Он отменяется после завершения теста, до запуска функций очистки.

```go
// хорошо: отмена приходит вместе с окончанием теста
ctx := t.Context()
result, err := Fetch(ctx, url)
```

```go
// плохо: контекст никогда не отменяется, горутины из теста могут остаться висеть
result, err := Fetch(context.Background(), url)
```

## Сравнение значений

`reflect.DeepEqual` различает `nil` и пустой срез. Это то же различие, что в JSON, и в тестах оно даёт непонятный провал, если ожидание написано как `[]Item{}`, а функция возвращает `nil`.

```go
// хорошо: различие nil и пустого среза проверяется явно, сравнение поле за полем
if len(got) != 0 {
	t.Errorf("Items() = %v, want empty", got)
}
```

```go
// плохо: DeepEqual вернёт false при nil против []Item{}, и причина не видна в выводе
if !reflect.DeepEqual(got, []Item{}) {
	t.Errorf("Items() = %v, want empty", got)
}
```

Ошибки проверяются через `errors.Is` и `errors.As`, как и в продакшене. Сравнение строки с текстом ошибки ломается при первой правке сообщения.

## Запуск

```bash
go test ./...
go test -race ./...
go test -count=1 -shuffle=on ./...
```

`-race` включает детектор гонок и нужен для любого кода с горутинами. `-count=1` отключает кеш результатов, когда тест зависит от состояния вне кода. `-shuffle=on` перемешивает порядок тестов и ловит зависимости между ними.

Медленные тесты отключают флагом `-short` и проверкой `testing.Short()` в начале теста.

```go
// хорошо: интеграционный тест пропускается в быстром прогоне
func TestSyncWithRealDatabase(t *testing.T) {
	if testing.Short() {
		t.Skip("медленный тест, запуск без -short")
	}
}
```

## Антипаттерны

Сгруппированы по теме. То, что уже показано выше, здесь не повторяется.

### Вызовы из чужой горутины

```go
// плохо: t.Fatal останавливает только эту горутину, тест продолжает работу без результата
go func() {
	if err := run(); err != nil {
		t.Fatal(err)
	}
}()
```

```go
// хорошо: ошибка уходит в канал и проверяется в горутине теста
errs := make(chan error, 1)
go func() {
	errs <- run()
}()
if err := <-errs; err != nil {
	t.Fatal(err)
}
```

### Глобальное состояние

```go
// плохо: глобальная переменная меняется в тесте и остаётся меняться после него
var clock = time.Now
func TestX(t *testing.T) {
	clock = func() time.Time { return fixed }
}
```

### Проверка лога вместо результата

```go
// плохо: тест проверяет строку лога, которую можно переформулировать без смены поведения
if !strings.Contains(buf.String(), "retrying") {
	t.Error("no retry")
}
```

Проверяй, что функция сделала: повторила запрос, вернула правильный результат, записала нужное значение в хранилище.
