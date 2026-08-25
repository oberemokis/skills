#!/usr/bin/env bash
# Собирает docs/skills.md из фронтматтера всех SKILL.md.
#
# Каталог генерируется, а не пишется руками, потому что написанный руками
# расходится с составом при первом же добавлении скилла.
#
# Скиллы-заготовки в каталог не попадают: их нет и в манифесте, а каталог
# должен показывать состав плагина, а не содержимое папки skills.
#
# Запускается из `pnpm bump`. С флагом --check ничего не пишет, а падает
# при расхождении с закоммиченным файлом.

set -uo pipefail
cd "$(dirname "$0")/.."

out="docs/skills.md"
check_only=0
[ "${1:-}" = "--check" ] && check_only=1

if [ "$check_only" = 1 ]; then
  target=$(mktemp)
else
  target="$out"
fi

{
  echo "# Каталог скиллов"
  echo
  echo "Файл генерируется скриптом \`./scripts/gen-catalog.sh\`, правки руками потеряются."
  echo
} > "$target"

current_group=""
count=0

while IFS= read -r file; do
  description=$(grep -m1 '^description:' "$file" | sed 's/^description: *//')

  # Заготовка: в описании остался угловой плейсхолдер шаблона.
  case "$description" in
    "<"*) continue ;;
  esac

  dir=$(dirname "$file")
  path=${dir#skills/}

  case "$path" in
    */*) group=${path%%/*} ;;
    *) group="верхний уровень" ;;
  esac

  if [ "$group" != "$current_group" ]; then
    echo "## $group" >> "$target"
    echo >> "$target"
    current_group="$group"
  fi

  name=$(grep -m1 '^name:' "$file" | sed 's/^name: *//')

  refs=$(find "$dir" -maxdepth 1 -name '*.md' -not -name 'SKILL.md' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$refs" -gt 0 ]; then
    suffix=" _(референсов: $refs)_"
  else
    suffix=""
  fi

  echo "### [$name]($(printf '%s' "../$dir/SKILL.md"))$suffix" >> "$target"
  echo >> "$target"
  echo "$description" >> "$target"
  echo >> "$target"
  count=$((count + 1))
done < <(find skills -name SKILL.md | LC_ALL=C sort)

if [ "$check_only" = 1 ]; then
  if ! diff -q "$target" "$out" > /dev/null 2>&1; then
    echo "каталог разошёлся с фронтматтером, запусти ./scripts/gen-catalog.sh" >&2
    rm -f "$target"
    exit 1
  fi
  rm -f "$target"
fi

echo "каталог: $count скиллов в $out"
