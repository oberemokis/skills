---
"oberemokis-skills": patch
---

`git/worktree` проверяет игнор путём внутри папки: `git check-ignore -q .worktrees/<имя>`. Правило `/.worktrees/` git применяет только к существующему каталогу, поэтому прежняя проверка `git check-ignore -q .worktrees` перед первым worktree всегда отвечала «не игнорируется», и агент дописывал в `.git/info/exclude` строку, которая там уже стояла.
