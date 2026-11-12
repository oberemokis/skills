#!/usr/bin/env bash
# Проверяет модули хуков плагина (hooks/): валидатор Claude Code и их тесты.
#
# Зачем копия: `claude plugin test` запускает каждый *.test.ts под папкой, а в
# evals/ лежат фикстуры с такими именами, которые тестами не являются.
# В копию идут только манифест, контракт состояния и модули.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v claude >/dev/null; then
  echo "нет claude в PATH: модули хуков не проверены" >&2
  exit 1
fi

claude plugin validate . >/dev/null || {
  claude plugin validate . >&2
  exit 1
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/.claude-plugin"
cp .claude-plugin/plugin.json "$tmp/.claude-plugin/"
cp -R hooks types "$tmp/"

claude plugin test "$tmp"
