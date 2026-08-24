#!/usr/bin/env bash
# Проверяет относительные ссылки в markdown-файлах репозитория.
#
# Ищет ссылки вида [текст](./путь.md) и [текст](../путь.md) и проверяет,
# что файл существует. Абсолютные ссылки и внешние адреса не трогает.
#
# Блоки кода пропускаются: ссылка внутри примера или шаблона это не ссылка,
# а иллюстрация. Плейсхолдеры вида <FILE>.md тоже пропускаются.

set -uo pipefail
cd "$(dirname "$0")/.."

broken=0
checked=0

while IFS= read -r pair; do
  file=${pair%%$'\t'*}
  link=${pair#*$'\t'}

  checked=$((checked + 1))

  if [ ! -e "$(dirname "$file")/$link" ]; then
    echo "битая ссылка: $file -> $link" >&2
    broken=$((broken + 1))
  fi
done < <(
  find . -name '*.md' -not -path './node_modules/*' -not -path './.git/*' -print0 |
    xargs -0 awk '
      FNR == 1 { infence = 0 }
      /^[[:space:]]*```/ { infence = !infence; next }
      infence { next }
      {
        line = $0
        while (match(line, /\]\(\.\.?\/[^)]*\.md\)/)) {
          link = substr(line, RSTART + 2, RLENGTH - 3)
          line = substr(line, RSTART + RLENGTH)
          if (link !~ /</) printf "%s\t%s\n", FILENAME, link
        }
      }
    '
)

if [ "$broken" -gt 0 ]; then
  echo "битых ссылок: $broken из $checked" >&2
  exit 1
fi

echo "ссылки в порядке: проверено $checked"
