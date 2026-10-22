// v1 のプラグイン用の保存場所（`storage` の権限、ADR-0018 §3）の判断。入出力を持たない（ブラウザへの保存は browser-store.ts）。
// プラグインごとに、キー → 値（JSON）の集まりを 1 つの JSON のテキストとして持ち、その大きさに上限を設ける。

import { sizeText } from "./transfer";

/** プラグイン 1 つが保存できる大きさの上限（キーと値を合わせた JSON の UTF-8 のバイト数）。 */
export const PLUGIN_STORAGE_LIMIT = 1024 * 1024;

/**
 * テキストの UTF-8 のバイト数を数える。
 *
 * @param text テキスト
 * @returns バイト数
 * @example
 * utf8Bytes("abc")  // → 3
 * utf8Bytes("要求") // → 6
 * utf8Bytes("")     // → 0（境界値）
 */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * 保存してある JSON のテキストを、キー → 値の集まりにする。読めない・形が違うときは空として扱う。
 *
 * @param json 保存してある JSON のテキスト（無ければ null）
 * @returns キー → 値
 * @example
 * storedValues('{"a":1}') // → { a: 1 }
 * storedValues(null)      // → {}
 * storedValues("[1]")     // → {}（形が違う）
 * storedValues("{")       // → {}（壊れた JSON）
 */
export function storedValues(json: string | null): Record<string, unknown> {
  if (json === null) return {};
  try {
    const v: unknown = JSON.parse(json);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * `storageGet` の答えにする値を引く。
 *
 * @param json 保存してある JSON のテキスト（無ければ null）
 * @param key キー
 * @returns 値。保存していなければ undefined（答えの value を省く）
 * @example
 * storedValue('{"a":{"n":1}}', "a") // → { n: 1 }
 * storedValue('{"a":1}', "b")       // → undefined
 * storedValue(null, "a")            // → undefined
 */
export function storedValue(json: string | null, key: string): unknown {
  const values = storedValues(json);
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

/**
 * `storageSet` を当てた後の JSON のテキストを作る。値が null ならキーを消す。上限を超えるなら保存しない。
 *
 * @param json 保存してある JSON のテキスト（無ければ null）
 * @param key キー
 * @param value 保存する値（JSON にできる値。null は消す）
 * @param limit 上限（UTF-8 のバイト数）
 * @returns 保存する JSON のテキスト（キーが無くなれば null。保存場所から消す）。上限を超えるなら `{ refused: 理由の文 }`
 * @example
 * storageUpdate(null, "a", 1, 100)          // → { json: '{"a":1}' }
 * storageUpdate('{"a":1}', "a", null, 100)  // → { json: null }（最後のキーを消した）
 * storageUpdate(null, "a", "x".repeat(200), 100)
 * // → { refused: "プラグイン用の保存場所の上限（100 バイト）を超えるため、「a」を保存しませんでした" }
 */
export function storageUpdate(json: string | null, key: string, value: unknown, limit: number): { json: string | null } | { refused: string } {
  const values = { ...storedValues(json) };
  if (value === null) delete values[key];
  else values[key] = value;
  if (!Object.keys(values).length) return { json: null };
  const next = JSON.stringify(values);
  if (utf8Bytes(next) > limit) return { refused: `プラグイン用の保存場所の上限（${sizeText(limit)}）を超えるため、「${key}」を保存しませんでした` };
  return { json: next };
}
