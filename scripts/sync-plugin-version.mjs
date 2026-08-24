#!/usr/bin/env node
// Копирует версию из package.json в .claude-plugin/plugin.json.
//
// Запускается как часть `pnpm version`, сразу после `changeset version`.
// С флагом --check ничего не меняет и завершается с кодом 1, если версии разошлись.
//
// Зачем: changesets умеет поднимать версию только в package.json, а плагин
// читает её из своего манифеста. Без этой синхронизации в манифесте навсегда
// остаётся версия, с которой репозиторий создавали.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, ".claude-plugin", "plugin.json");

const { version } = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const source = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(source);

if (manifest.version === version) {
  console.log(`версия в манифесте ${version}, синхронно`);
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error(
    `в манифесте ${manifest.version}, в package.json ${version}. Запусти node scripts/sync-plugin-version.mjs`,
  );
  process.exit(1);
}

// Переписываем только строку с версией, чтобы сохранить порядок ключей
// и форматирование остального файла.
const updated = source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);

if (JSON.parse(updated).version !== version) {
  console.error(`не нашёл поле version в ${manifestPath}`);
  process.exit(1);
}

writeFileSync(manifestPath, updated);
console.log(`версия в манифесте обновлена до ${version}`);
