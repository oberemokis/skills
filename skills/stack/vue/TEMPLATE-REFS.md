# Ссылки на элементы и компоненты

Читается из [SKILL.md](./SKILL.md), когда ссылка пуста, указывает не туда или перестала работать после правки.

## Объявление

В проекте принята форма с `ref` и атрибутом `ref="name"`. Тип обязательно с `| null`, инициализация `null`.

```ts
// хорошо
const zoomButton = ref<HTMLButtonElement | null>(null)
```

```ts
// плохо: без null в типе обращение до монтирования пройдёт проверку типов
const zoomButton = ref<HTMLButtonElement>()
```

Vue 3.5 добавила `useTemplateRef("name")`, где связь идёт по строке, а не по совпадению имени переменной с атрибутом. Форма надёжнее при переименованиях, но в проекте пока не используется. Следуй существующему коду.

## Пусто до монтирования и при v-if

Обращаться не раньше `onMounted`, доступ через `?.`.

```ts
// хорошо
onMounted(() => zoomButton.value?.focus())
```

```ts
// плохо: TypeError, когда элемент скрыт v-if
watchEffect(() => zoomButton.value.focus())
```

Если ссылка нужна постоянно, `v-show` вместо `v-if` решает задачу в корне: элемент остаётся в DOM, ссылка не обнуляется.

Отдельная тонкость с `await`: между началом `onMounted` и продолжением после ожидания компонент мог размонтироваться, и ссылка стать `null`. Перепроверяй после каждого `await`.

```ts
// хорошо
onMounted(async () => {
  await loadFonts()
  zoomButton.value?.focus()
})
```

## Порядок в v-for не гарантирован

Массив ссылок из `v-for` не обязан совпадать по порядку с исходным массивом. В большинстве случаев совпадает, поэтому баг всплывает только при переупорядочивании, и выглядит как случайность.

```vue
<!-- хорошо: сопоставление по идентификатору, а не по индексу -->
<template>
  <li v-for="item in items" :key="item.id" :data-id="item.id" ref="itemRefs">
    {{ item.title }}
  </li>
</template>
```

```ts
// хорошо: найти нужный элемент по данным
const target = itemRefs.value.find((el) => el.dataset.id === item.id)
```

```ts
// плохо: индекс не гарантирует соответствие
const target = itemRefs.value[index]
```

Второй рабочий способ это функциональная ссылка с собственной картой, которая чистится перед обновлением:

```ts
const itemsById = new Map<string, HTMLElement>()

function setItemRef(el: HTMLElement | null, item: Item) {
  if (el) itemsById.set(item.id, el)
  else itemsById.delete(item.id)
}

onBeforeUpdate(() => itemsById.clear())
```

## Ссылка на компонент

Типизируется через `InstanceType` и даёт доступ только к тому, что компонент выставил через `defineExpose`.

```ts
// хорошо
const child = ref<InstanceType<typeof ChildComponent> | null>(null)
onMounted(() => child.value?.focus())
```

```ts
// плохо: обращение к внутреннему состоянию, которого нет в defineExpose
onMounted(() => child.value.items.push(newItem))
```

Если понадобилось дотянуться до внутренностей компонента, обычно неверна не ссылка, а граница: либо чего-то не хватает в `defineExpose`, либо состояние вообще должно жить снаружи.

## Порядок в разметке имеет значение

Элемент, накрывающий соседей, перехватывает их клики. Порядок объявления решает, кто окажется сверху, и это не про ссылки, но ломается вместе с ними.

```vue
<!-- хорошо: кнопка на всю площадь объявлена раньше стрелок и точек -->
<template>
  <button class="absolute inset-0" @click="zoomed = true" />
  <button class="absolute left-3" @click="go(-1)" />
</template>
```

Если стрелки объявить первыми, накрывающая кнопка съест их клики, а ссылка на них при этом будет живой и валидной.
