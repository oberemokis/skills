# Go: антипаттерны

> Вернуться к [golang](SKILL.md). Всё, что уже показано в правилах, здесь не повторяется.

Сгруппированы по теме.

### Ошибки

```go
// плохо
result, _ := load(path)                  // ошибка выброшена молча
return errors.New(err.Error())           // цепочка оборвана на входе
if err != nil { return err }             // err из пакета без контекста: где упало?
```

### Время и горутины

```go
// плохо
time.Sleep(5)                            // пять наносекунд, а не секунд: единица не задана
go worker()                              // ни отмены, ни ожидания

// хорошо
time.Sleep(5 * time.Second)
```

### Имена и пакеты

```go
// плохо
package utils                            // имя не говорит, что внутри
func GetUserName(user User) string       // Get в геттере
type OrderService struct{}               // в пакете order это order.OrderService
```

### Типы

```go
// плохо: any на входе снимает проверку, как any в TypeScript
func render(value any) string

// хорошо: конкретный тип, а дженерик только там, где вход связан с выходом
func renderOrder(order *Order) string
```

Параметр типа оправдан, если он связывает аргумент с результатом, как в `func First[T any](items []T) (T, bool)`. Если он встречается в сигнатуре один раз, это `any` с лишним шумом.

### Nil-срезы

```go
// плохо: nil даёт "items": null, фронт ждёт массив
type Response struct {
	Items []Item `json:"items"`
}
resp := Response{}
```

```go
// хорошо: явный пустой срез даёт "items": []
resp := Response{Items: []Item{}}
```

Nil-срез для `len`, `range` и `append` ведёт себя как пустой, и менять его на пустой нужно только на границе сериализации.
