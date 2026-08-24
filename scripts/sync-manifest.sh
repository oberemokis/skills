#!/usr/bin/env bash
# Пересобирает массив "skills" в .claude-plugin/plugin.json из файловой системы.
#
# Зачем: автодискавери Claude Code находит SKILL.md только на один уровень
# вложенности от skills/. Всё, что лежит глубже (skills/stack/vue,
# skills/test/tdd), обязано быть перечислено в манифесте явно, иначе скилл
# не загрузится, и никакой ошибки при этом не будет.
#
# Запускать после любого добавления, переноса или удаления скилла.

set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST=".claude-plugin/plugin.json"

paths=$(find skills -name SKILL.md \
  | sed 's|/SKILL.md$||' \
  | sed 's|^|./|' \
  | LC_ALL=C sort)

if [ -z "$paths" ]; then
  echo "не найдено ни одного SKILL.md" >&2
  exit 1
fi

json_array=$(printf '%s\n' "$paths" | jq -R . | jq -s .)

tmp=$(mktemp)
jq --argjson skills "$json_array" '.skills = $skills' "$MANIFEST" > "$tmp"
mv "$tmp" "$MANIFEST"

echo "в манифесте $(printf '%s\n' "$paths" | wc -l | tr -d ' ') скиллов"

# Обратная проверка: путь в манифесте без файла ломает загрузку так же,
# как и отсутствующий путь.
missing=0
while IFS= read -r p; do
  if [ ! -e "$p/SKILL.md" ]; then
    echo "битый путь: $p/SKILL.md" >&2
    missing=1
  fi
done < <(jq -r '.skills[]' "$MANIFEST")

# Имена скиллов обязаны быть уникальными: коллизия name перекрывает скилл.
dupes=$(grep -rh '^name:' skills --include=SKILL.md | sed 's/^name: *//' | LC_ALL=C sort | uniq -d)
if [ -n "$dupes" ]; then
  echo "повторяющиеся name:" >&2
  echo "$dupes" >&2
  missing=1
fi

exit "$missing"
