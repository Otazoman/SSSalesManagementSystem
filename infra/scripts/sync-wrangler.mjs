#!/usr/bin/env node
// wrangler.jsonc.example(ひな形、Git管理)から wrangler.jsonc(Git管理外)を作る。
// Terraformで作成済みの環境があれば、その出力の値を埋め込む:
//   - production / staging の wrangler_bindings → D1: database_name / database_id、R2: bucket_name、KV: id
//     (バインディング名で探して書き換える)
//   - --store-id で指定したSecrets StoreのストアID → secrets_store_secrets の store_id(backend・frontend とも)
//     (Secrets StoreはCloudflareが自動作成し1アカウント1つのため、Terraformでは管理しない。
//      IDは `npx wrangler secrets-store store list --remote` で確認する。指定しなければ、
//      今ある wrangler.jsonc の値を引き継ぐ)
// Terraformが未構築(state・出力が無い)の環境は、ひな形の仮の値のままにする(ローカル開発はそれで動く)。
// wrangler.jsonc のコメント・整形は保ったまま、値の部分だけを置き換える。
//
// 2026-09-23: 以前は Git管理下の wrangler.jsonc を直接書き換えていたが、実IDがGitの差分に出続け、
// 誤コミットや clone のたびの書き換え直しが起きるため、ひな形から毎回作り直す方式に変更した。
// 毎回ひな形から作るので、ひな形にバインディングを追加した場合も同じコマンドで反映される。
//
// #14-2①(2026-09-22): env.staging(named environment)を追加したため、production/staging
// それぞれの範囲だけを探して書き換える(バインディング名は production 側にも env.staging 側にも
// 同じ名前で出てくるため、範囲を区別しないと production の方だけを繰り返し書き換えてしまう)。
//
// 使い方(リポジトリのルートから):
//   node infra/scripts/sync-wrangler.mjs                          # 確認のみ(何が埋め込まれるかを表示、ファイルは作らない)
//   node infra/scripts/sync-wrangler.mjs --write                  # packages/backend・frontend の wrangler.jsonc を作る(上書き)
//   node infra/scripts/sync-wrangler.mjs --store-id <ID> --write  # ストアIDも埋め込む(初回のみ。以降は引き継がれる)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENVIRONMENTS = ["production", "staging"];
const STORE_ID_PLACEHOLDER = "SECRETS_STORE_ID_PLACEHOLDER";

// 作成する wrangler.jsonc。frontend は D1/R2/KV を使わないため、store_id だけを埋める
const TARGETS = [
  { example: "packages/backend/wrangler.jsonc.example", output: "packages/backend/wrangler.jsonc", bindings: true },
  { example: "packages/frontend/wrangler.jsonc.example", output: "packages/frontend/wrangler.jsonc", bindings: false },
];

// バインディングの種類ごとに、wrangler.jsonc の中で書き換えるキー
const KEYS = {
  d1: ["database_name", "database_id"],
  r2: ["bucket_name"],
  kv: ["id"],
};
// Terraformの出力のキー名 → wrangler.jsonc のキー名
const OUTPUT_KEY = { database_name: "database_name", database_id: "database_id", bucket_name: "bucket_name", id: "id" };

/** text[openIndex]が"{"である前提で、対応する閉じ"}"の位置を返す。見つからなければ-1 */
function findBalancedBraceEnd(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** "env": { ... } ブロックの範囲({の位置からその閉じ}まで、両端含む)。無ければnull */
function findEnvBlockRange(text) {
  const m = /"env"\s*:\s*\{/.exec(text);
  if (!m) return null;
  const openIdx = text.indexOf("{", m.index);
  const closeIdx = findBalancedBraceEnd(text, openIdx);
  if (closeIdx < 0) return null;
  return { start: m.index, end: closeIdx + 1, bodyStart: openIdx, bodyEnd: closeIdx };
}

/** "env": { ... } の中にある、指定した名前の環境("staging"等)のブロック範囲。無ければnull */
function findNamedEnvRange(text, envName) {
  const envBlock = findEnvBlockRange(text);
  if (!envBlock) return null;
  const body = text.slice(envBlock.bodyStart, envBlock.bodyEnd + 1);
  const marker = new RegExp(String.raw`"${envName}"\s*:\s*\{`).exec(body);
  if (!marker) return null;
  const openIdx = body.indexOf("{", marker.index);
  const closeIdx = findBalancedBraceEnd(body, openIdx);
  if (closeIdx < 0) return null;
  return { start: envBlock.bodyStart + marker.index, end: envBlock.bodyStart + closeIdx + 1 };
}

/**
 * "binding": "NAME" を含むオブジェクト({ から } まで)の位置を返す。
 * onlyRange指定時はその範囲内の出現だけを、excludeRanges指定時はその範囲を除いた出現を探す
 * (production探索時にenv.staging側の同名バインディングを誤って拾わないようにするため)。
 * 見つからなければnull
 */
function findBindingBlock(text, binding, { onlyRange = null, excludeRanges = [] } = {}) {
  const marker = new RegExp(String.raw`"binding"\s*:\s*"${binding}"`, "g");
  let match;
  while ((match = marker.exec(text))) {
    const idx = match.index;
    if (onlyRange && (idx < onlyRange.start || idx >= onlyRange.end)) continue;
    if (excludeRanges.some((r) => idx >= r.start && idx < r.end)) continue;
    const start = text.lastIndexOf("{", idx);
    const end = text.indexOf("}", idx);
    if (start < 0 || end < 0) return null;
    return { start, end: end + 1 };
  }
  return null;
}

/**
 * wrangler.jsonc の本文へ、Terraformの出力を反映する。envNameで対象範囲を絞る
 * ("production"はenv.*ブロックを除いたトップレベル、それ以外はenv.<envName>の中だけ)。
 * @returns {{ text: string, changes: string[], missing: string[] }}
 */
export function applyBindings(text, bindings, envName = "production") {
  const changes = [];
  const missing = [];
  let result = text;

  for (const [kind, keys] of Object.entries(KEYS)) {
    for (const [binding, values] of Object.entries(bindings[kind] ?? {})) {
      // resultは1バインディング書き換えるたびに長さが変わりうるため、範囲は都度resultから計算し直す
      let searchOptions;
      if (envName === "production") {
        const envBlock = findEnvBlockRange(result);
        searchOptions = { excludeRanges: envBlock ? [{ start: envBlock.start, end: envBlock.end }] : [] };
      } else {
        const named = findNamedEnvRange(result, envName);
        if (!named) throw new Error(`wrangler.jsonc に "env"."${envName}" が見つかりません`);
        searchOptions = { onlyRange: named };
      }

      const block = findBindingBlock(result, binding, searchOptions);
      if (!block) {
        missing.push(`${kind}:${binding}`);
        continue;
      }
      let body = result.slice(block.start, block.end);
      for (const key of keys) {
        const next = values[OUTPUT_KEY[key]];
        if (next === undefined) throw new Error(`${kind}:${binding} の出力に ${OUTPUT_KEY[key]} がありません`);
        const pattern = new RegExp(String.raw`("${key}"\s*:\s*")([^"]*)(")`);
        const found = pattern.exec(body);
        if (!found) throw new Error(`${kind}:${binding} に "${key}" の設定がありません`);
        if (found[2] !== next) changes.push(`${kind}:${binding}.${key}  ${found[2]} -> ${next}`);
        body = body.replace(pattern, (_all, head, _old, tail) => `${head}${next}${tail}`);
      }
      result = result.slice(0, block.start) + body + result.slice(block.end);
    }
  }
  return { text: result, changes, missing };
}

/**
 * secrets_store_secrets の store_id をすべて(本番・staging とも)storeId に置き換える
 * (ストアは1アカウント1つのため、本番・staging で同じ値)。
 * @returns {{ text: string, changes: string[] }}
 */
export function applyStoreId(text, storeId) {
  const changes = [];
  const pattern = /("store_id"\s*:\s*")([^"]*)(")/g;
  const result = text.replace(pattern, (_all, head, old, tail) => {
    if (old !== storeId) changes.push(`store_id  ${old} -> ${storeId}`);
    return `${head}${storeId}${tail}`;
  });
  return { text: result, changes };
}

/**
 * ひな形の本文から wrangler.jsonc の本文を作る。storeId・envBindings の値は、Terraformが未構築なら null。
 * @param {string} exampleText
 * @param {{ storeId?: string | null, envBindings?: Record<string, object | null>, bindings?: boolean }} options
 * @returns {{ text: string, changes: string[], missing: string[] }}
 */
export function buildConfig(exampleText, { storeId = null, envBindings = {}, bindings = true } = {}) {
  let text = exampleText;
  const changes = [];
  const missing = [];
  if (storeId) {
    const applied = applyStoreId(text, storeId);
    text = applied.text;
    changes.push(...applied.changes.map((c) => `[account] ${c}`));
  }
  if (bindings) {
    for (const env of ENVIRONMENTS) {
      const envOutput = envBindings[env];
      if (!envOutput) continue;
      const applied = applyBindings(text, envOutput, env);
      text = applied.text;
      changes.push(...applied.changes.map((c) => `[${env}] ${c}`));
      missing.push(...applied.missing.map((m) => `[${env}] ${m}`));
    }
  }
  return { text, changes, missing };
}

/** 本文中の store_id(仮の値以外)を返す。無ければnull(--store-id 未指定時に、前回の値を引き継ぐため) */
export function findStoreId(text) {
  const match = /"store_id"\s*:\s*"([^"]*)"/.exec(text ?? "");
  return match && match[1] && match[1] !== STORE_ID_PLACEHOLDER ? match[1] : null;
}

function parseArgs(argv) {
  const args = { write: false, storeId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") args.write = true;
    else if (a === "--store-id") {
      args.storeId = argv[++i];
      if (!args.storeId || !/^[0-9a-f]{32}$/.test(args.storeId)) {
        throw new Error("--store-id には32桁のストアID(wrangler secrets-store store list --remote の ID)を指定してください");
      }
    } else throw new Error(`不明な引数: ${a}(使えるのは --write / --store-id <ID>)`);
  }
  return args;
}

/**
 * terraform output -json <name> の値。Terraformが未構築(state・出力が無い)、または terraform が
 * 使えない場合は { value: null, reason } を返す(エラーにはしない)
 */
function readTerraformOutput(root, env, name) {
  const dir = resolve(root, "infra/terraform/environments", env);
  if (!existsSync(resolve(dir, "terraform.tfstate"))) {
    return { value: null, reason: "未構築(terraform.tfstate が無い)" };
  }
  const runOptions = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const outputArgs = ["-chdir=" + dir, "output", "-no-color", "-json", name];
  const attempts = [
    ["terraform", outputArgs],
    // terraform を mise で入れている場合、PATH に無いことがあるので mise 経由でもう一度試す
    ["mise", ["exec", "--", "terraform", ...outputArgs]],
  ];
  let lastError = "";
  for (const [command, commandArgs] of attempts) {
    try {
      return { value: JSON.parse(execFileSync(command, commandArgs, runOptions)), reason: null };
    } catch (err) {
      const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
      const lines = stderr.split(/\r?\n/).map((line) => line.trim());
      lastError = lines.find((line) => line.startsWith("Error:")) || lines.find(Boolean) || String(err);
    }
  }
  // apply前・destroy後は state に出力が無い(= 未構築)
  if (/Output ".*" not found|No outputs found/.test(lastError)) {
    return { value: null, reason: "未構築(terraform apply 前)" };
  }
  return { value: null, reason: `出力を読めません(${lastError})` };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(fileURLToPath(import.meta.url), "../../..");

  const currentBackend = resolve(root, TARGETS[0].output);
  const storeId =
    args.storeId ?? (existsSync(currentBackend) ? findStoreId(readFileSync(currentBackend, "utf8")) : null);
  console.log(
    `Secrets Store のストアID: ${
      args.storeId ? "--store-id で指定" : storeId ? "今ある wrangler.jsonc から引き継ぎ" : "未指定 → 仮の値のまま(ローカル開発はこれで動く)"
    }`,
  );
  const envBindings = {};
  console.log("Terraform の出力:");
  for (const env of ENVIRONMENTS) {
    const out = readTerraformOutput(root, env, "wrangler_bindings");
    envBindings[env] = out.value;
    console.log(`  ${env}: ${out.value ? "あり" : `なし → 仮の値のまま / ${out.reason}`}`);
  }

  for (const target of TARGETS) {
    const exampleText = readFileSync(resolve(root, target.example), "utf8");
    const { text, changes, missing } = buildConfig(exampleText, {
      storeId,
      envBindings,
      bindings: target.bindings,
    });
    const outputPath = resolve(root, target.output);
    const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;

    console.log(`\n${target.output}(${target.example} から作成)`);
    if (changes.length === 0) console.log("  ひな形の仮の値のまま(埋め込む実IDはありません)");
    else for (const line of changes) console.log("  " + line);
    if (missing.length > 0) {
      console.log("  ひな形に見つからなかったバインディング(Terraformにだけ定義がある):");
      for (const m of missing) console.log("    " + m);
    }

    if (current === text) {
      console.log("  → 現在の wrangler.jsonc と同じ内容です(作り直す必要はありません)");
      continue;
    }
    if (!args.write) {
      console.log(current === null ? "  → wrangler.jsonc はまだありません" : "  → 現在の wrangler.jsonc と内容が異なります");
      continue;
    }
    writeFileSync(outputPath, text);
    console.log(`  → ${target.output} を${current === null ? "作成" : "上書き"}しました`);
  }

  if (!args.write) console.log("\n確認のみです。wrangler.jsonc を作るには --write を付けてください。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`エラー: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
