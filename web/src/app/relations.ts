// 2 つの要素の間に追加できる関係を決める。

import type { Entry, ModelNode } from "../core";
import { S } from "./state";

export type RelKind = "comp" | "satisfy" | "verify" | "frame" | "derive" | "flow";

/** 定義の種類に対応する、部品として持つときのキーワード。 */
export const KW_FOR: Record<string, string> = {
  "part def": "part", "requirement def": "requirement", "constraint def": "constraint", "state def": "exhibit state",
  "action def": "perform action", "analysis def": "analysis", "verification def": "verification", "port def": "port", "item def": "item",
  "attribute def": "attribute", "concern def": "concern", "calc def": "calc", "interface def": "interface",
};

/** a と b を部品として持つ共通の定義（flow を書く場所）。 */
export function commonParent(a: ModelNode, b: ModelNode): { parent: Entry; ua: Entry; ub: Entry } | null {
  for (const e of S.P.entries) {
    if (!e.isDef) continue;
    const ua = e.children.find((c) => c.kind === "part" && c.type === a.name);
    const ub = e.children.find((c) => c.kind === "part" && c.type === b.name);
    if (ua && ub) return { parent: e, ua, ub };
  }
  return null;
}

/** a から b へ追加できる関係の一覧。 */
export function relOptions(a: ModelNode | null, b: ModelNode | null): { rel: RelKind; label: string }[] {
  const o: { rel: RelKind; label: string }[] = [];
  if (!a || !b) return o;
  if (a.usage || b.usage) return a.usage && b.usage && a.key !== b.key ? [{ rel: "flow", label: "flow 信号・物理量を流す" }] : o;
  if (a.lifeline || b.lifeline) return o;
  const isReq = (n: ModelNode): boolean => /^requirement/.test(n.kind);
  if (a.isDef && b.isDef && a.key !== b.key && !["concern def", "item def", "port def"].includes(a.kind)) {
    o.push({ rel: "comp", label: `${KW_FOR[b.kind] ?? "part"} として持つ` });
  }
  if (isReq(b) && /^part/.test(a.kind)) o.push({ rel: "satisfy", label: "«satisfy» 要求を満たす" });
  if (isReq(b) && a.kind === "verification def") o.push({ rel: "verify", label: "«verify» 要求を検証する" });
  if (isReq(a) && b.kind === "concern def") o.push({ rel: "frame", label: "«frame» 関心事を扱う" });
  if (a.kind === "requirement def" && b.kind === "requirement def" && a.key !== b.key) o.push({ rel: "derive", label: "«derive» この要求から導出" });
  if (/^part/.test(a.kind) && /^part/.test(b.kind) && commonParent(a, b)) o.push({ rel: "flow", label: "flow 信号・物理量を流す" });
  return o;
}
