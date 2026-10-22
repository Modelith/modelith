// 2 つの要素の間に追加できる関係を決める。

import type { Entry, ModelNode } from "../core";
import { canSucceed } from "./action-flow";
import { canTransition } from "./state-machine";
import { kindLabel } from "./labels";
import { S } from "./state";

export type RelKind = "comp" | "satisfy" | "verify" | "frame" | "derive" | "flow" | "succession" | "transition";

/** 追加できる関係の候補。reverse なら、関係の元は線の先（b）で、先が線の元（a）になる（線を引いた向きと関係の向きが逆）。 */
export interface RelChoice {
  rel: RelKind;
  label: string;
  reverse?: boolean;
}

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
 * a から b へ線を引いたときに追加できる関係の一覧を作る。接続の案内（インスペクタ）で選べる候補になる。
 * 使用（usage）どうしなら flow だけ、ライフラインかメモを含むなら無し。アクションの流れの図の要素どうしなら順序（succession）だけ（canSucceed）、
 * 状態遷移の図の要素どうしなら遷移（transition）だけ（canTransition）。
 * 定義どうしなら持つ・満たす・検証する・扱う・導出する・flow から合うものを並べ、要求をつなぐ関係は線の向きによらず出す（reqRelOptions）。
 *
 * @param a 線の元の要素（未選択なら null）
 * @param b 線の先の要素（未選択なら null）
 * @returns 関係の候補の配列（reverse の候補は b から a への関係）。追加できる関係が無い・どちらかが null なら空の配列
 * @example
 * // a が part def、b が requirement def のとき
 * relOptions(a, b) // → [{ rel: "comp", label: "要求として持つ" }, { rel: "satisfy", label: "要求を満たす «satisfy»" }]
 * // a が requirement def、b が part def のとき
 * relOptions(a, b) // → [{ rel: "comp", label: "部品として持つ" }, { rel: "satisfy", label: "この部品で満たす «satisfy»", reverse: true }]
 * // アクションの流れの図で、heat から notify へ
 * relOptions(heat, notify) // → [{ rel: "succession", label: "この後に実行する（順序 succession）" }]
 * // 状態遷移の図で、off から on へ
 * relOptions(off, on) // → [{ rel: "transition", label: "この状態から遷移する（transition）" }]
 * relOptions(a, null) // → []
 */
export function relOptions(a: ModelNode | null, b: ModelNode | null): RelChoice[] {
  const o: RelChoice[] = [];
  if (!a || !b) return o;
  if (a.usage || b.usage) return a.usage && b.usage && a.key !== b.key ? [{ rel: "flow", label: "信号・物理量を流す（flow）" }] : o;
  if (a.flow || b.flow) return canSucceed(a, b) ? [{ rel: "succession", label: "この後に実行する（順序 succession）" }] : o;
  if (a.state || b.state) return canTransition(a, b) ? [{ rel: "transition", label: "この状態から遷移する（transition）" }] : o;
  if (a.lifeline || b.lifeline || a.note || b.note) return o;
  if (a.isDef && b.isDef && a.key !== b.key && !["concern def", "item def", "port def"].includes(a.kind)) {
    o.push({ rel: "comp", label: `${kindLabel(KW_FOR[b.kind] ?? "part")}として持つ` });
  }
  o.push(...reqRelOptions(a, b));
  if (/^part/.test(a.kind) && /^part/.test(b.kind) && commonParent(a, b)) o.push({ rel: "flow", label: "信号・物理量を流す（flow）" });
  return o;
}

/** 要求をつなぐ関係で、相手になる要素（ModelNode のうち、ここで使う所だけ）。 */
export interface ReqRelEnd {
  key: string;
  kind: string;
}

/**
 * 要求をつなぐ関係（満たす・検証する・扱う・導出する）のうち、a と b の間に書ける関係を、線を引いた向きによらず返す。
 * 関係の向きは規格どおり（部品が要求を満たす・検証が要求を確かめる・要求が関心事を扱う・導出した要求から導出元へ）で、
 * 線の向きと逆なら reverse を付ける。要求どうしなら、導出の両向きを出す。
 *
 * @param a 線の元の要素
 * @param b 線の先の要素
 * @returns 関係の候補（a から b への関係を先に、b から a への関係（reverse）を後に並べる）。書ける関係が無ければ空の配列
 * @example
 * reqRelOptions(P, R) // → [{ rel: "satisfy", label: "要求を満たす «satisfy»" }]（P は part def、R は requirement def）
 * reqRelOptions(R, P) // → [{ rel: "satisfy", label: "この部品で満たす «satisfy»", reverse: true }]
 * reqRelOptions(R, V) // → [{ rel: "verify", label: "この検証で確かめる «verify»", reverse: true }]（V は verification def）
 * reqRelOptions(R, S) // → [{ rel: "derive", label: "この要求から導出する «derive»" }, { rel: "derive", label: "この要求へ展開する «derive»", reverse: true }]
 * reqRelOptions(R, R) // → []（自分自身）
 * reqRelOptions(P, V) // → []（要求を含まない）
 */
export function reqRelOptions(a: ReqRelEnd, b: ReqRelEnd): RelChoice[] {
  if (a.key === b.key) return [];
  const isReq = (n: ReqRelEnd): boolean => /^requirement/.test(n.kind);
  const isPart = (n: ReqRelEnd): boolean => /^part/.test(n.kind);
  const o: RelChoice[] = [];
  if (isReq(b) && isPart(a)) o.push({ rel: "satisfy", label: "要求を満たす «satisfy»" });
  if (isReq(b) && a.kind === "verification def") o.push({ rel: "verify", label: "要求を検証する «verify»" });
  if (isReq(a) && b.kind === "concern def") o.push({ rel: "frame", label: "関心事を扱う «frame»" });
  if (a.kind === "requirement def" && b.kind === "requirement def") {
    o.push({ rel: "derive", label: "この要求から導出する «derive»" }, { rel: "derive", label: "この要求へ展開する «derive»", reverse: true });
  }
  if (isReq(a) && isPart(b)) o.push({ rel: "satisfy", label: "この部品で満たす «satisfy»", reverse: true });
  if (isReq(a) && b.kind === "verification def") o.push({ rel: "verify", label: "この検証で確かめる «verify»", reverse: true });
  if (isReq(b) && a.kind === "concern def") o.push({ rel: "frame", label: "この要求で扱う «frame»", reverse: true });
  return o;
}
