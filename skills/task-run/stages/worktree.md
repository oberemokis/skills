# Этап worktree: рабочая копия

## С `--fleet`

Worktree создал оркестратор, сессия уже в нём. Проверь:

- `git rev-parse --abbrev-ref HEAD` равно `--branch`;
- `git rev-parse --show-toplevel` равно `--worktree`;
- `git rev-parse --abbrev-ref @{u}` отвечает ошибкой: upstream у ветки нет, иначе `git push` уйдёт прямо в базу;
- `git config branch.<ветка>.base` равно `--base`: нет или другое, запиши `--base` (шаг 6 ниже).

Что-то не так: `blocked`. `EnterWorktree` не вызывай.

## Без `--fleet`

Корень проекта это `root` из ответа `resolve-project.mjs`, папка worktree `<root>/<worktree.dir>/<ветка с - вместо />`.

Войти в worktree посреди сессии умеет только Claude Code (`EnterWorktree`, шаг 9). Агент без него: этап `blocked` до шага 1 с причиной «без `--fleet` задача ведётся только в Claude Code, запусти её через `/task-fleet <ID> --agent <вид>`».

1. `git worktree list`: worktree ветки уже есть, тогда только шаг 6 и вход в него.
2. `git check-ignore -q <dir>/<имя>` в корне: проверяется путь внутри папки, правило на ещё не созданную папку не срабатывает. Не игнорируется: допиши `/<dir>/` в `.git/info/exclude` и скажи об этом одной строкой. `.gitignore` не трогай, он общий.
3. `flock <общий .git>/task-run-fetch.lock git fetch origin`: несколько worktree одного репозитория иначе ловят «cannot lock ref».
4. Ветка уже есть (локально или на origin): `git worktree add <путь> <ветка>`, внутри `git merge origin/<база>`. Конфликт: `git merge --abort`, стоп.
5. Ветки нет: `git worktree add <путь> -b <ветка> --no-track origin/<база>`.
6. `git config branch.<ветка>.base <база>`: от неё панель Review считает дифф. Пиши и для ветки, которая уже была: база могла смениться.
7. Проверка upstream, как выше.
8. Подготовка по `project.json`: файлы из `localFiles` скопируй из основной папки, если их нет; строки `exclude` допиши в `.git/info/exclude`; команды `install` выполни в своих папках.
9. `EnterWorktree(path=<путь>)`. Запиши путь в файл.

Перед каждой правкой и коммитом ветка в worktree должна быть веткой задачи.

## Дифф

Пользователь видит дифф по мере правок, а не только на показе. Когда проверять, написано в разделе «Дифф» `SKILL.md`.

В Herdr открывать ничего не надо: панель Review следит за worktree терминала в фокусе и перечитывает дифф сама, а новое пространство открывается с ней.

Не в Herdr напиши пользователю одной строкой команду gitone в worktree. Она зависит от числа коммитов на ветке, `git rev-list --count origin/<база>..HEAD`:

- ноль: `gitone` без аргументов, он покажет всё незакоммиченное вместе с новыми файлами;
- больше нуля: `gitone $(git merge-base origin/<база> HEAD)`. Новые файлы с аргументами он не показывает, их перечисляет вопрос show.
