# Этап worktree: рабочая копия

## С `--fleet`

Worktree создал оркестратор, сессия уже в нём. Проверь:

- `git rev-parse --abbrev-ref HEAD` равно `--branch`;
- `git rev-parse --show-toplevel` равно `--worktree`;
- `git rev-parse --abbrev-ref @{u}` отвечает ошибкой: upstream у ветки нет, иначе `git push` уйдёт прямо в базу.

Что-то не так: `blocked`. `EnterWorktree` не вызывай.

## Без `--fleet`

Корень проекта это `root` из ответа `resolve-project.mjs`, папка worktree `<root>/<worktree.dir>/<ветка с - вместо />`.

1. `git worktree list`: worktree ветки уже есть, тогда только войди в него.
2. `git check-ignore -q <dir>/<имя>` в корне: проверяется путь внутри папки, правило на ещё не созданную папку не срабатывает. Не игнорируется: допиши `/<dir>/` в `.git/info/exclude` и скажи об этом одной строкой. `.gitignore` не трогай, он общий.
3. `flock <общий .git>/task-run-fetch.lock git fetch origin`: несколько worktree одного репозитория иначе ловят «cannot lock ref».
4. Ветка уже есть (локально или на origin): `git worktree add <путь> <ветка>`, внутри `git merge origin/<база>`. Конфликт: `git merge --abort`, стоп.
5. Ветки нет: `git worktree add <путь> -b <ветка> --no-track origin/<база>`.
6. Проверка upstream, как выше.
7. Подготовка по `project.json`: файлы из `localFiles` скопируй из основной папки, если их нет; строки `exclude` допиши в `.git/info/exclude`; команды `install` выполни в своих папках.
8. `EnterWorktree(path=<путь>)`. Запиши путь в файл.

Перед каждой правкой и коммитом ветка в worktree должна быть веткой задачи.

## gitone

gitone стоит рядом с сессией всю работу над задачей, чтобы пользователь видел дифф по мере правок, а не только на показе. Дифф он перечитывает сам, когда меняются файлы. Когда открывать, написано в разделе «gitone» `SKILL.md`.

Под herdr (`HERDR_ENV=1`) открой его в соседней панели своей вкладки, если его там нет (`herdr pane list --workspace "$HERDR_WORKSPACE_ID"`, заголовок терминала `gitone`): `herdr pane split --pane "$HERDR_PANE_ID" --direction right --cwd <worktree> --no-focus`, затем `herdr pane run <новая панель> "<команда>"`.

Команда по коммитам на ветке, `git rev-list --count origin/<база>..HEAD`:

- ноль: `gitone` без аргументов, он покажет всё незакоммиченное вместе с новыми файлами;
- больше нуля: `gitone $(git merge-base origin/<база> HEAD)`. Новые файлы с аргументами он не показывает, их перечисляет вопрос show.

Без herdr напиши пользователю одной строкой, какой командой открыть gitone в worktree.
