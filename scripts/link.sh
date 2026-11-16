#!/usr/bin/env bash
# Ставит скиллы и ревьюеров из этого клона агентам. Claude Code, OpenCode и папка ~/.agents/skills (Codex,
# Kimi, Gemini и другие) получают ссылки на клон: правка файла в клоне видна всем сразу, без переустановки.
# Codex получает TOML-указатель на файл агента: Markdown-агентов он не читает.
#
#   ./scripts/link.sh
#
# Повторный запуск ничего не меняет. Запускай после git pull, после добавления, переименования или удаления
# скилла и после lean-ctx init или uninstall: они переписывают папки агентов.
#
# Код выхода 0: всё на месте; 1: на месте ссылки чужая папка, файл или ссылка, их надо убрать руками.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
CLAUDE_SKILLS="$HOME/.claude/skills"
AGENTS_SKILLS="$HOME/.agents/skills"
CLAUDE_AGENTS="$HOME/.claude/agents"
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
# По этой строке скрипт узнаёт свои TOML: чужой файл с тем же именем он не перезаписывает.
MARKER="# Создано scripts/link.sh, ручная правка перезапишется. Источник:"

created=0 kept=0 removed=0 conflicts=0

say() { printf '%s\n' "$*"; }
warn() { printf 'внимание: %s\n' "$*" >&2; }

# Ссылка dst на src. Свою устаревшую ссылку (в этот клон) и битую заменяет, чужое не трогает.
link() {
  local src=$1 dst=$2 current
  if [ -L "$dst" ]; then
    current=$(readlink "$dst")
    if [ "$current" = "$src" ]; then
      kept=$((kept + 1))
      return
    fi
    case $current in
      "$REPO"/*) ;;
      *)
        if [ -e "$dst" ]; then
          warn "$dst ведёт в $current, а не в клон: убери ссылку и запусти снова"
          conflicts=$((conflicts + 1))
          return
        fi
        ;;
    esac
    rm "$dst"
  elif [ -e "$dst" ]; then
    warn "$dst настоящая папка или файл, а не ссылка: перенеси в архив и запусти снова"
    conflicts=$((conflicts + 1))
    return
  fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  say "ссылка $dst"
  created=$((created + 1))
}

# Убирает ссылку, только если она ведёт в этот клон.
unlink_ours() {
  if [ -L "$1" ]; then
    case $(readlink "$1") in
      "$REPO"/*)
        rm "$1"
        say "убрана ссылка $1"
        removed=$((removed + 1))
        ;;
    esac
  fi
}

# Битые ссылки в клон остаются от удалённого или переименованного скилла.
prune() {
  local path
  [ -d "$1" ] || return 0
  for path in "$1"/*; do
    if [ -L "$path" ] && [ ! -e "$path" ]; then unlink_ours "$path"; fi
  done
}

# Значение ключа верхнего уровня из фронтматтера, без кавычек.
field() {
  awk -v key="$2" '
    NR == 1 && $0 == "---" { inside = 1; next }
    inside && $0 == "---" { exit }
    inside && index($0, key ": ") == 1 { value = substr($0, length(key) + 3); gsub(/^"|"$/, "", value); print value; exit }
  ' "$1"
}

# metadata.internal: true, скилл только для Claude Code.
is_internal() {
  awk '
    NR == 1 && $0 == "---" { inside = 1; next }
    inside && $0 == "---" { exit }
    inside && /^[[:space:]]+internal:[[:space:]]*true[[:space:]]*$/ { found = 1 }
    END { exit !found }
  ' "$1"
}

codex_toml() {
  local description
  description=$(field "$1" description | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '%s %s\n' "$MARKER" "$1"
  printf 'name = "%s"\n' "$(basename "$1" .md)"
  printf 'description = "%s"\n' "$description"
  # Ревьюеры только читают, как и в полях Claude Code и OpenCode того же файла.
  printf 'sandbox_mode = "read-only"\n'
  printf 'developer_instructions = """\n'
  printf 'Твоя роль описана в файле %s. Прочитай его целиком до начала работы и следуй тексту после фронтматтера.\n' "$1"
  printf 'Фронтматтер настраивает Claude Code и OpenCode, тебе он не нужен.\n'
  printf 'Скиллы, которые называет этот файл, установлены в ~/.agents/skills/<имя>/SKILL.md.\n'
  printf '"""\n'
}

codex_agent() {
  local dst want
  dst="$CODEX_DIR/agents/$(basename "$1" .md).toml"
  want=$(codex_toml "$1")
  if [ -e "$dst" ] && ! head -n 1 "$dst" | grep -qF "$MARKER"; then
    warn "$dst написан не link.sh: не трогаю"
    conflicts=$((conflicts + 1))
    return
  fi
  if [ -f "$dst" ] && [ "$(cat "$dst")" = "$want" ]; then
    kept=$((kept + 1))
    return
  fi
  mkdir -p "$(dirname "$dst")"
  printf '%s\n' "$want" >"$dst"
  say "codex $dst"
  created=$((created + 1))
}

branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
if [ "$branch" != main ]; then
  warn "клон на ветке $branch, а не на main: агенты увидят скиллы этой ветки"
fi

if [ "$(git -C "$REPO" config core.hooksPath || true)" != .githooks ]; then
  git -C "$REPO" config core.hooksPath .githooks
  say "pre-push хук включён: core.hooksPath .githooks"
fi

for dir in "$REPO"/skills/*/; do
  dir=${dir%/}
  name=${dir##*/}
  [ -f "$dir/SKILL.md" ] || continue
  link "$dir" "$CLAUDE_SKILLS/$name"
  # Скилл только для Claude Code в общую папку не идёт, а поставленный раньше оттуда убирается.
  if is_internal "$dir/SKILL.md"; then
    unlink_ours "$AGENTS_SKILLS/$name"
  else
    link "$dir" "$AGENTS_SKILLS/$name"
  fi
done

[ -d "$OPENCODE_DIR" ] || say "OpenCode не найден ($OPENCODE_DIR): агенты ему не ставятся"
[ -d "$CODEX_DIR" ] || say "Codex не найден ($CODEX_DIR): агенты ему не ставятся"

for agent in "$REPO"/agents/*.md; do
  [ -f "$agent" ] || continue
  role=$(basename "$agent")
  link "$agent" "$CLAUDE_AGENTS/$role"
  if [ -d "$OPENCODE_DIR" ]; then link "$agent" "$OPENCODE_DIR/agents/$role"; fi
  if [ -d "$CODEX_DIR" ]; then codex_agent "$agent"; fi
done

prune "$CLAUDE_SKILLS"
prune "$AGENTS_SKILLS"
prune "$CLAUDE_AGENTS"
prune "$OPENCODE_DIR/agents"

# TOML агента, которого в клоне больше нет.
if [ -d "$CODEX_DIR/agents" ]; then
  for toml in "$CODEX_DIR"/agents/*.toml; do
    [ -f "$toml" ] || continue
    head -n 1 "$toml" | grep -qF "$MARKER $REPO/" || continue
    [ -f "$REPO/agents/$(basename "$toml" .toml).md" ] && continue
    rm "$toml"
    say "убран $toml"
    removed=$((removed + 1))
  done
fi

say "готово: новых $created, без изменений $kept, убрано $removed, конфликтов $conflicts"
[ "$conflicts" -eq 0 ]
