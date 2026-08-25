#!/usr/bin/env bash
# Пересобирает массив "skills" в .claude-plugin/plugin.json из файловой системы.
#
# Зачем: автодискавери Claude Code находит SKILL.md только на один уровень
# вложенности от skills/. Всё, что лежит глубже (skills/stack/vue,
# skills/test/tdd), обязано быть перечислено в манифесте явно, иначе скилл
# не загрузится, и никакой ошибки при этом не будет.
#
# Массив в манифесте автопоиск не отменяет, а дополняет. Проверено на 0.2.0:
# skills/design лежал на первом уровне и в манифест не попадал, а в списке
# скиллов у агента всё равно оказался, с незаполненным описанием. Значит
# исключить скилл первого уровня из загрузки нельзя вовсе, его надо физически
# унести из skills/. Заготовки живут в drafts/, туда автопоиск не заглядывает.
#
# Скилл-заготовка в манифест не попадает. Признак заготовки: description
# начинается с "<", то есть в нём остался угловой плейсхолдер шаблона.
# Описание это единственный текст скилла, который всегда лежит в контексте,
# поэтому плейсхолдер оттуда виден агенту и ломает маршрутизацию.
#
# Запускать после любого добавления, переноса или удаления скилла.
# С флагом --check ничего не пишет, а падает при расхождении: для CI и хуков.

set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST=".claude-plugin/plugin.json"
check_only=0
[ "${1:-}" = "--check" ] && check_only=1

all=$(find skills -name SKILL.md | sed 's|/SKILL.md$||' | LC_ALL=C sort)

if [ -z "$all" ]; then
  echo "не найдено ни одного SKILL.md" >&2
  exit 1
fi

# Заготовки отсеиваются, но о них сообщается: молча пропавший скилл хуже,
# чем скилл с плейсхолдером.
paths=""
drafts=""
while IFS= read -r dir; do
  desc=$(sed -n 's/^description: *//p' "$dir/SKILL.md" | head -1)
  if [ -z "$desc" ]; then
    echo "нет description: $dir/SKILL.md" >&2
    exit 1
  fi
  case "$desc" in
    "<"*)
      # Заготовка на первом уровне грузится вопреки манифесту, поэтому это
      # не предупреждение, а ошибка: её надо унести из skills/.
      depth=$(printf '%s' "$dir" | tr -cd '/' | wc -c | tr -d ' ')
      if [ "$depth" -le 1 ]; then
        echo "заготовка на первом уровне грузится вопреки манифесту: $dir" >&2
        echo "перенеси её в drafts/, автопоиск туда не заглядывает" >&2
        exit 1
      fi
      drafts="${drafts}${dir}"$'\n'
      ;;
    *) paths="${paths}./${dir}"$'\n' ;;
  esac
done <<< "$all"

paths=$(printf '%s' "$paths" | sed '/^$/d')
json_array=$(printf '%s\n' "$paths" | jq -R . | jq -s .)
current=$(jq -c '.skills' "$MANIFEST")
desired=$(printf '%s' "$json_array" | jq -c .)

if [ "$check_only" = 1 ]; then
  if [ "$current" != "$desired" ]; then
    echo "манифест разошёлся с файловой системой, запусти ./scripts/sync-manifest.sh" >&2
    exit 1
  fi
else
  tmp=$(mktemp)
  jq --argjson skills "$json_array" '.skills = $skills' "$MANIFEST" > "$tmp"
  mv "$tmp" "$MANIFEST"
fi

echo "в манифесте $(printf '%s\n' "$paths" | wc -l | tr -d ' ') скиллов"

if [ -n "$drafts" ]; then
  printf '%s' "$drafts" | sed '/^$/d' | while IFS= read -r dir; do
    echo "заготовка, в манифест не включена: $dir" >&2
  done
fi

# Обратная проверка: путь в манифесте без файла ломает загрузку так же,
# как и отсутствующий путь.
broken=0
while IFS= read -r p; do
  if [ ! -e "$p/SKILL.md" ]; then
    echo "битый путь: $p/SKILL.md" >&2
    broken=1
  fi
done < <(jq -r '.skills[]' "$MANIFEST")

# Имена скиллов обязаны быть уникальными: коллизия name перекрывает скилл.
dupes=$(grep -rh '^name:' skills --include=SKILL.md | sed 's/^name: *//' | LC_ALL=C sort | uniq -d)
if [ -n "$dupes" ]; then
  echo "повторяющиеся name:" >&2
  echo "$dupes" >&2
  broken=1
fi

# Имя во фронтматтере обязано совпадать с именем каталога: маршрутизация в
# core идёт по имени папки, а Claude Code загружает скилл по полю name.
while IFS= read -r dir; do
  name=$(sed -n 's/^name: *//p' "$dir/SKILL.md" | head -1)
  if [ "$name" != "$(basename "$dir")" ]; then
    echo "name не совпадает с каталогом: ${name} в $dir" >&2
    broken=1
  fi
done <<< "$all"

exit "$broken"
