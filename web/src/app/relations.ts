// 2 つの要素の間に追加できる関係を決める。

import type { Entry, ModelNode } from "../core";
import { canSucceed } from "./action-flow";
import { kindLabel } from "./labels";
import { S } from "./state";

export type RelKind = "comp" | "satisfy" | "verify" | "frame" | "derive" | "flow" | "succession";

/** 定義の種類に対応する、部品として持つときのキーワード。 */
export const KW_FOR: Record<string, string> = {
  "part def": "part", "requirement def": "requirement", "constraint def": "constraint", "state def": "exhibit state",
  "action def": "perform action", "analysis def": "analysis", "verification def": "verification", "port def": "port", "item def": "item",
  "attribute def": "attribute", "concern def": "concern", "calc def": "calc", "interface def": "interface",
};

/**
 * a と b の両方を部品（`part`）として持つ定義を探す。flow を書く場所になる。
 * 解析結果 S.P の定義を先頭から調べ、最初に見つかったものを返す。
 *
 * @param a 一方の端の定義（その名前を型に持つ部品を探す）
 * @param b もう一方の端の定義
 * @returns 共通の定義と、その中の a・b の部品。無ければ null
 * @example
 * // S.P に「part def K { part h : Heater; part s : Sensor; }」があるとき
 * commonParent(Heater, Sensor) // → { parent: K, ua: h, ub: s }
 * commonParent(Heater, Other)  // → null（両方を持つ定義が無い）
 */
export function commonParent(a: ModelNode, b: ModelNode): { parent: Entry; ua: Entry; ub: Entry } | null {
  for (const e of S.P.entries) {
    if (!e.isDef) continue;
    const ua = e.children.find((c) => c.kind === "part" && c.type === a.name);
    const ub = e.children.find((c) => c.kind === "part" && c.type === b.name);
    if (ua && ub) return { parent: e, ua, ub };
  }
  return null;
}

/**
 * a から b へ追加できる関係の一覧を作る。接続の案内（インスペクタ）で選べる候補になる。
 * 使用（usage）どうしなら flow だけ、ライフラインかメモを含むなら無し。アクションの流れの図の要素どうしなら順序（succession）だけ（canSucceed）。
 * 定義どうしなら持つ・満たす・検証する・扱う・導出する・flow から合うものを並べる。
 *
 * @param a 関係の元の要素（未選択なら null）
 * @param b 関係の先の要素（未選択なら null）
 * @returns 関係の種類と画面の言葉の組の配列。追加できる関係が無い・どちらかが null なら空の配列
 * @example
 * // a が part def、b が requirement def のとき
 * relOptions(a, b) // → [{ rel: "comp", label: "要求として持つ" }, { rel: "satisfy", label: "要求を満たす «satisfy»" }]
 * // アクションの流れの図で、heat から notify へ
 * relOptions(heat, notify) // → [{ rel: "succession", label: "この後に実行する（順序 succession）" }]
 * relOptions(a, null) // → []
 */
export function relOptions(a: ModelNode | null, b: ModelNode | null): { rel: RelKind; label: string }[] {
  const o: { rel: RelKind; label: string }[] = [];
  if (!a || !b) return o;
  if (a.usage || b.usage) return a.usage && b.usage && a.key !== b.key ? [{ rel: "flow", label: "信号・物理量を流す（flow）" }] : o;
  if (a.flow || b.flow) return canSucceed(a, b) ? [{ rel: "succession", label: "この後に実行する（順序 succession）" }] : o;
  if (a.lifeline || b.lifeline || a.note || b.note) return o;
  const isReq = (n: ModelNode): boolean => /^requirement/.test(n.kind);
  if (a.isDef && b.isDef && a.key !== b.key && !["concern def", "item def", "port def"].includes(a.kind)) {
    o.push({ rel: "comp", label: `${kindLabel(KW_FOR[b.kind] ?? "part")}として持つ` });
  }
  if (isReq(b) && /^part/.test(a.kind)) o.push({ rel: "satisfy", label: "要求を満たす «satisfy»" });
  if (isReq(b) && a.kind === "verification def") o.push({ rel: "verify", label: "要求を検証する «verify»" });
  if (isReq(a) && b.kind === "concern def") o.push({ rel: "frame", label: "関心事を扱う «frame»" });
  if (a.kind === "requirement def" && b.kind === "requirement def" && a.key !== b.key) o.push({ rel: "derive", label: "この要求から導出する «derive»" });
  if (/^part/.test(a.kind) && /^part/.test(b.kind) && commonParent(a, b)) o.push({ rel: "flow", label: "信号・物理量を流す（flow）" });
  return o;
}
