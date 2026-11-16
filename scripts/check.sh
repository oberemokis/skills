#!/usr/bin/env bash
# Одна команда проверок репозитория: ссылки, утечки, фронтматтер и тесты скриптов.
# Её запускают pre-push хук (.githooks/pre-push) и CI.
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/check.mjs .

# Шаблоны раскрывает сам node --test, а не оболочка.
node --test 'skills/**/*.test.mjs' 'scripts/*.test.mjs'
