#!/usr/bin/env bash
# Собирает docs/skills.md из фронтматтера всех SKILL.md.
#
# Каталог генерируется, а не пишется руками, потому что написанный руками
# расходится с составом при первом же добавлении скилла.
#
# Запускается из `pnpm version` и `pnpm check`.

set -uo pipefail
cd "$(dirname "$0")/.."

out="docs/skills.md"

{
  echo "# Каталог скиллов"
  echo
  echo "Файл генерируется скриптом \`./scripts/gen-catalog.sh\`, правки руками потеряются."
  echo
} > "$out"

current_group=""

while IFS= read -r file; do
  dir=$(dirname "$file")
  path=${dir#skills/}

  case "$path" in
    */*) group=${path%%/*} ;;
    *) group="верхний уровень" ;;
  esac

  if [ "$group" != "$current_group" ]; then
    echo "## $group" >> "$out"
    echo >> "$out"
    current_group="$group"
  fi

  name=$(grep -m1 '^name:' "$file" | sed 's/^name: *//')
  description=$(grep -m1 '^description:' "$file" | sed 's/^description: *//')

  refs=$(find "$dir" -maxdepth 1 -name '*.md' -not -name 'SKILL.md' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$refs" -gt 0 ]; then
    suffix=" _(референсов: $refs)_"
  else
    suffix=""
  fi

  echo "### [$name]($(printf '%s' "../$dir/SKILL.md"))$suffix" >> "$out"
  echo >> "$out"
  echo "$description" >> "$out"
  echo >> "$out"
done < <(find skills -name SKILL.md | LC_ALL=C sort)

count=$(find skills -name SKILL.md | wc -l | tr -d ' ')
echo "каталог собран: $count скиллов в $out"
