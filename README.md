# skills

Личные скиллы в формате [Agent Skills](https://agentskills.io): папка `skills/<имя>` с файлом `SKILL.md`. Их читают Claude Code, Codex, OpenCode и другие агенты, которые знают этот формат.

[`core`](./skills/core/SKILL.md) подключается сам и несёт базовую настройку: правила текста, маршрутизацию к скиллам стека, критерии завершения. Дорогие этапы вызываются вручную: `grill` перед работой, `audit` для разбора кода на находки, `review` для ревью диффа, `humanizer` для вычитки текста.

## Установка для себя

```bash
git clone https://github.com/oberemokis/skills
cd skills
./scripts/link.sh
```

`link.sh` ставит каждый скилл ссылкой на клон в `~/.claude/skills` и `~/.agents/skills`, а ревьюеров из `agents/` в `~/.claude/agents` и `~/.config/opencode/agents`. Codex получает в `~/.codex/agents` TOML, который велит прочитать файл ревьюера: Markdown-агентов Codex не читает. Правка в клоне доходит до агентов сразу, переустанавливать ничего не надо.

Заодно скрипт включает pre-push хук с проверками через `core.hooksPath`. Если `core.hooksPath` уже задан, например глобальной папкой хуков, скрипт его не трогает: иначе хуки той папки в клоне перестали бы работать. Тогда вызови `.githooks/pre-push` клона из `pre-push` своей папки хуков, и предупреждение пропадёт.

Запускай `link.sh` снова после `git pull`, если скилл добавлен, переименован или удалён, и после `lean-ctx init` или `uninstall`: они переписывают папки агентов. Повторный запуск ничего не меняет.

Клон держи на `main`, ветки веди в worktree внутри клона (`.worktrees/<ветка>`). Ссылки ведут в основную папку, и агенты видят ту ветку, на которой она стоит. Если это не `main`, `link.sh` предупредит.

Если на месте ссылки уже лежит настоящая папка, например от прежней установки, `link.sh` её не трогает: называет и выходит с кодом 1. Перенеси папку в архив и запусти скрипт снова.

## Установка для других

```bash
npx skills add oberemokis/skills
```

[skills](https://github.com/vercel-labs/skills) копирует скиллы в папки выбранных агентов. `task-run` и `task-fleet` он пропускает: они помечены `metadata.internal`, работают только в Claude Code внутри Herdr и завязаны на мой процесс. Ревьюеров из `agents/` он не ставит, их копируй руками. Без них `review` проводит обе роли сам.

Не запускай `npx skills add` поверх `link.sh`. Он удаляет ссылку и кладёт на её место копию, и правки клона перестают доходить до агента.

## Агенты

| Агент | Где ищет скиллы | Ручной вызов | Ревьюеры |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/skills` | `/grill` | `~/.claude/agents/<роль>.md` |
| Codex | `~/.agents/skills` | `$grill` | `~/.codex/agents/<роль>.toml` |
| OpenCode | `~/.claude/skills`, `~/.agents/skills`, `~/.config/opencode/skills` | `@grill` | `~/.config/opencode/agents/<роль>.md` |
| Kimi, Gemini CLI, Cursor, Copilot CLI, Amp, Goose | `~/.agents/skills` | по документации агента | нет |

Ручной скилл помечен дважды. `disable-model-invocation: true` во фронтматтере читают Claude Code и OpenCode (OpenCode 1.18.0 из Homebrew его ещё не знает), `agents/openai.yaml` с `allow_implicit_invocation: false` читает Codex. Остальные агенты могут позвать такой скилл и сами.

Файл ревьюера один на всех: Claude Code и OpenCode берут из фронтматтера свои поля и пропускают чужие, Codex читает только текст после фронтматтера.

## Структура

```
skills/<имя>/SKILL.md     скилл; рядом справочники, scripts/ и agents/openai.yaml
agents/<роль>.md          ревьюеры для скилла review
drafts/                   незаполненные скиллы, агенты их не видят
scripts/check.sh          все проверки одной командой
scripts/link.sh           установка ссылками
docs/                     как устроено и как писать
```

Скиллы по группам:

- базовая настройка: `core`
- вызываются вручную: `grill`, `audit`, `review`, `humanizer`
- тесты: хаб `test` и под ним `tdd`, `unit-tests`, `integration-tests`, `e2e-tests`, `test-review`, `coverage`, `bug-hunting`
- стек: `effect`, `golang`, `nitro`, `nuxt`, `pinia`, `playwright`, `pnpm`, `tailwind`, `turbo`, `typescript`, `vite`, `vitest`, `vue`, `vueuse`
- git: `commit-rules`, `worktree`
- только Claude Code в Herdr: `task-run`, `task-fleet`

## Документация

- [Как это работает](./docs/flow.md): что подключается само и что вызывается вручную, дерево решений и фронтир, швы и форма теста
- [Как добавить скилл](./docs/authoring.md): порядок, фронтматтер, структура тела, где живёт референс
- [Как писать скиллы](./docs/conventions.md): правила текста, примеров и объёма
- [Один репозиторий на всех агентов](./docs/skills-repo.md): почему ссылки вместо плагина, что получает каждый агент, откат
- [task-run и task-fleet](./docs/task-run.md): запись решения

## Проверки

```bash
./scripts/check.sh
```

Скрипт ищет битые ссылки, в том числе пути в обратных кавычках, и утечки: ID задач, внутренние хосты, личные пути, упоминания людей. Ещё он сверяет фронтматтер со стандартом и пару пометок ручного вызова, а затем гоняет `node --test` по тестам скриптов. Его запускают pre-push хук и CI. Репозиторий публичный, поэтому главный барьер это хук: CI видит утечку уже после пуша.
