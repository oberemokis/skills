#!/usr/bin/env bash
# Ищет в ядре skills/task следы конкретного проекта: ID задач, @-упоминания людей, адреса хостов.
#
# Зачем: ядро публичное и общее для всех проектов, а данные проекта живут у пользователя
# в ~/.local/state/task-run/<проект>/. Точного списка запрещённого здесь нет нарочно:
# он сам опубликовал бы то, что прячем. Поэтому проверка по формам, а примеры в ядре
# пишутся с PROJ-123 и хостами example.org, host.org, mirror.org.

set -euo pipefail
cd "$(dirname "$0")/.."

target="skills/task"
found=0

report() {
  local title="$1" matches="$2"
  [ -z "$matches" ] && return
  echo "$title:"
  echo "$matches" | sed 's/^/  /'
  found=1
}

ids=$(grep -rnE '\b[A-Z]{2,}-[0-9]+\b' "$target" | grep -vE '\b(PROJ|UTF|ISO)-[0-9]+\b' || true)
report "ID задач конкретного проекта (в примерах PROJ-123)" "$ids"

mentions=$(grep -rnE '(^|[[:space:](«])@[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_.]*' "$target" || true)
report "@-упоминания людей" "$mentions"

# status.app это поле JSON `hc get`, а не хост.
hosts=$(grep -rnoiE '\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|ru|studio|dev|app|team)\b' "$target" \
  | grep -viE ':(([a-z0-9-]+\.)*(example\.org|host\.org|mirror\.org)|status\.app)$' || true)
report "адреса хостов (в примерах example.org, host.org, mirror.org)" "$hosts"

if [ "$found" -ne 0 ]; then
  echo "в $target остались следы проекта: перенеси их в project.json или rules.md проекта" >&2
  exit 1
fi

echo "утечек в $target нет"
