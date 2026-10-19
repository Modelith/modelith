// v1 のプラグインの許可（ADR-0018 §5、F-PLUG-6）の判断と画面の言葉。入出力を持たない（保存は host.ts がブラウザに行う）。

import type { Permission } from "./generated/protocol";
import { NETWORK_WARNING, permissionLines, PERMISSION_WORDS } from "./permissions";

/** ブラウザに覚える、プラグイン 1 つへの利用者の答え。 */
export interface TrustRecord {
  decision: "allowed" | "denied";
  /** 答えたときに宣言されていた権限（名前の順）。 */
  permissions: Permission[];
  /** 答えたときのプラグインのバージョン。 */
  version: string;
  /** 答えたときのプログラムのファイルの SHA-256（16 進の小文字）。 */
  sha256: string;
}

/** ブラウザに覚える許可の全体（localStorage の 1 つのキーに JSON で置く）。キーはプラグインの ID。 */
export interface TrustStore {
  format: 1;
  plugins: Record<string, TrustRecord>;
}

/** 今のプラグインの、許可に関わる情報。 */
export interface TrustSubject {
  permissions: readonly Permission[];
  version: string;
  sha256: string;
}

/** 許可の判断。ask は尋ねる理由（初めて・権限が増えた・外部と通信できるプラグインが変わった）と、増えた権限。 */
export type TrustCheck =
  | { kind: "allowed" }
  | { kind: "denied" }
  | { kind: "ask"; reason: "first" | "permissions" | "changed"; added: Permission[] };

/**
 * 覚えている答えと今のプラグインから、尋ねずに動かすか・許可されていないか・尋ねるかを決める（ADR-0018 §5）。
 * 尋ね直すのは、宣言した権限が増えたときと、外部と通信できる（network を宣言した）プラグインのバージョンかファイルが変わったときだけ。
 * 許可しなかったプラグインは、利用者が一覧の「許可する…」を押すまで尋ねない。
 *
 * @param record 覚えている答え（無ければ undefined）
 * @param now 今のプラグインの権限・バージョン・ファイルのハッシュ
 * @returns 判断
 * @example
 * trustCheck(undefined, now)                                             // → { kind: "ask", reason: "first", added: [] }
 * trustCheck({ decision: "allowed", permissions: [], … }, { permissions: ["model:read"], … })
 * // → { kind: "ask", reason: "permissions", added: ["model:read"] }
 * trustCheck({ decision: "allowed", permissions: ["network"], sha256: "a", … }, { permissions: ["network"], sha256: "b", … })
 * // → { kind: "ask", reason: "changed", added: [] }
 * trustCheck({ decision: "allowed", permissions: ["model:read"], sha256: "a", … }, { permissions: ["model:read"], sha256: "b", … })
 * // → { kind: "allowed" }（外部と通信できないので、中身が変わっても尋ねない）
 * trustCheck({ decision: "denied", … }, now)                             // → { kind: "denied" }
 */
export function trustCheck(record: TrustRecord | undefined, now: TrustSubject): TrustCheck {
  if (!record) return { kind: "ask", reason: "first", added: [] };
  if (record.decision === "denied") return { kind: "denied" };
  const added = now.permissions.filter((p) => !record.permissions.includes(p));
  if (added.length) return { kind: "ask", reason: "permissions", added };
  if (now.permissions.includes("network") && (record.version !== now.version || record.sha256 !== now.sha256)) return { kind: "ask", reason: "changed", added: [] };
  return { kind: "allowed" };
}

/**
 * 答えを覚える形にする（権限は名前の順にそろえる）。
 *
 * @param decision 利用者の答え
 * @param now 答えたときのプラグインの権限・バージョン・ファイルのハッシュ
 * @returns 覚える答え
 * @example
 * trustRecord("allowed", { permissions: ["network", "model:read"], version: "1.0.0", sha256: "ab" })
 * // → { decision: "allowed", permissions: ["model:read", "network"], version: "1.0.0", sha256: "ab" }
 */
export function trustRecord(decision: TrustRecord["decision"], now: TrustSubject): TrustRecord {
  return { decision, permissions: [...now.permissions].sort(), version: now.version, sha256: now.sha256 };
}

/**
 * 覚えた許可の JSON を読む。読めない・形が違うときは、何も覚えていないものとして扱う（尋ね直すほうに倒す）。
 *
 * @param text localStorage から読んだ JSON（無ければ null）
 * @returns 許可の全体
 * @example
 * parseTrustStore(null)                                        // → { format: 1, plugins: {} }
 * parseTrustStore('{"format":1,"plugins":{"jp.x":{…}}}')       // → { format: 1, plugins: { "jp.x": {…} } }
 * parseTrustStore("{")                                         // → { format: 1, plugins: {} }（壊れた JSON）
 * parseTrustStore('{"format":1,"plugins":{"jp.x":{"decision":"maybe"}}}') // → { format: 1, plugins: {} }（形の違う項目は捨てる）
 */
export function parseTrustStore(text: string | null): TrustStore {
  const empty: TrustStore = { format: 1, plugins: {} };
  if (text === null) return empty;
  try {
    const raw = JSON.parse(text) as { format?: unknown; plugins?: unknown };
    if (raw.format !== 1 || typeof raw.plugins !== "object" || raw.plugins === null) return empty;
    const plugins: Record<string, TrustRecord> = {};
    for (const [id, r] of Object.entries(raw.plugins as Record<string, unknown>)) if (isTrustRecord(r)) plugins[id] = r;
    return { format: 1, plugins };
  } catch {
    return empty;
  }
}

/**
 * 覚えた答え 1 つの形が正しいか。
 *
 * @param r JSON から読んだ値
 * @returns 答え・権限の並び・バージョン・ハッシュがそろっていれば true
 * @example
 * isTrustRecord({ decision: "allowed", permissions: [], version: "1.0.0", sha256: "ab" }) // → true
 * isTrustRecord({ decision: "allowed", permissions: ["fs"], version: "1.0.0", sha256: "ab" }) // → false（知らない権限）
 * isTrustRecord(null)                                                                       // → false
 */
function isTrustRecord(r: unknown): r is TrustRecord {
  if (typeof r !== "object" || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    (x["decision"] === "allowed" || x["decision"] === "denied") &&
    Array.isArray(x["permissions"]) &&
    x["permissions"].every((p) => typeof p === "string" && p in PERMISSION_WORDS) &&
    typeof x["version"] === "string" &&
    typeof x["sha256"] === "string"
  );
}

/** 許可を尋ねるダイアログの中身。 */
export interface TrustPrompt {
  title: string;
  text: string;
  /** 使う権限の言葉。 */
  items: string[];
  /** 外部と通信できるときの注意。無ければ undefined。 */
  warning?: string;
  confirm: string;
  cancel: string;
}

/**
 * 許可を尋ねるダイアログの中身を作る（名前・作者・ID・バージョン・使う権限。外部と通信できるならその注意。F-PLUG-6）。
 * 作者はマニフェストの自己申告。書いていなければ「記載なし」と示す。
 *
 * @param plugin プラグインの名前・作者（書いてあれば）・ID・バージョン・宣言した権限
 * @param check 尋ねる理由と、増えた権限
 * @returns ダイアログの中身
 * @example
 * trustPrompt({ name: "要求の ID の補完", author: "山田 花子", id: "jp.example.fill", version: "1.0.0", permissions: ["edits:propose"] }, { kind: "ask", reason: "first", added: [] })
 * // → { title: "プラグインの実行の許可", text: "プラグイン「要求の ID の補完」（作者：山田 花子、ID：jp.example.fill、バージョン 1.0.0）を初めて実行します。…", items: ["モデルのテキストを変更する（変更は元に戻せます）（edits:propose）"], confirm: "許可して実行", cancel: "許可しない" }
 * trustPrompt({ …, permissions: ["network"] }, { kind: "ask", reason: "changed", added: [] }).warning
 * // → "このプラグインは、あなたのモデルを外部に送信できます。…"
 */
export function trustPrompt(
  plugin: { name: string; author?: string; id: string; version: string; permissions: readonly Permission[] },
  check: Extract<TrustCheck, { kind: "ask" }>,
): TrustPrompt {
  const who = `プラグイン「${plugin.name}」（作者：${plugin.author ?? "記載なし"}、ID：${plugin.id}、バージョン ${plugin.version}）`;
  const lead = {
    first: `${who}を初めて実行します。`,
    permissions: `${who}の使う権限が、前回許可したときより増えました（増えた権限：${check.added.map((p) => PERMISSION_WORDS[p]).join("、")}）。`,
    changed: `外部と通信できる${who}のバージョンかファイルが、前回許可したときから変わりました。`,
  }[check.reason];
  return {
    title: "プラグインの実行の許可",
    text: `${lead}このプラグインはプログラムを含みます。アプリとは切り離された場所で動き、開いているモデルのテキストを受け取って、次の権限だけを使えます。実行を許可しますか？`,
    items: permissionLines(plugin.permissions),
    warning: plugin.permissions.includes("network") ? NETWORK_WARNING : undefined,
    confirm: "許可して実行",
    cancel: "許可しない",
  };
}
