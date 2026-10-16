// 画面で図を作る操作（ADR-0005、F-VIEW-8）。利用者には「図を保存する・図に入れる・図から外す」と見せ、
// テキストには標準の view と expose を書く（ADR-0014）。

import type { Entry, ModelNode, ViewKind } from "../core";
import { ask } from "./dialog";
import { perform } from "./intent";
import { openModelView } from "./panels";
import { S } from "./state";
import { commitLayout, setText, settled, toast } from "./sync";
import { CC, curLayout, curView, modelView } from "./views";

/** 自動の図から、保存する図の描き方を決める。 */
const KIND_OF: Record<string, ViewKind> = { ibd: "interconnection", seq: "sequence", behavior: "stateTransition" };

/** 保存された図のうち、要素を 1 つずつ入れたり外したりできる図（内部ブロック図・シーケンス図は対象の中身で決まる）。 */
export const editableView = (): boolean => !!modelView() && S.view !== "ibd" && S.view !== "seq";

/** 保存された図に、まだ入っていない要素か（図に入れられるか）。 */
export function canAddToView(e: Entry): boolean {
  const n = S.M.nodeOf.get(e);
  return editableView() && !!n && !(modelView()?.nodeKeys.includes(n.key) ?? false);
}

/** まだ使われていない図の名前の候補。 */
function suggestName(base: string): string {
  const used = new Set(S.M.views.map((v) => v.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** 表示中の自動の図を、名前を付けて保存する（テキストに view を書き、そのタブを開く）。 */
export async function saveAsView(): Promise<void> {
  if (S.modelView) return;
  const pkg = S.P.entries.find((e) => e.kind === "package");
  const kind = KIND_OF[S.view] ?? "general";
  const c = CC();
  const targets = kind === "interconnection" || kind === "sequence" ? (c.ctx ? [c.ctx.key] : []) : c.nodes.map((n) => n.key);
  if (!pkg || !targets.length) {
    toast("図に要素が無いため、保存できません");
    return;
  }
  const r = await ask("図を保存", "名前を付けて保存します。保存した図は、＋メニューの「保存された図」からいつでも開けます。", [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "保存", kind: "primary" },
  ], { value: suggestName(`${curView().label}の図`), label: "図の名前" });
  if (r?.id !== "ok") return;
  const name = r.value.trim();
  const ins = await perform({ op: "saveView", name, kind, targets });
  if (!ins) return;
  // 見えている配置のまま保存する（内部ブロック図・シーケンス図は、対象ごとの配置をそのまま使う）
  if (kind === "general" || kind === "stateTransition") S.layout[`view:${name}`] = structuredClone(curLayout());
  setText(ins.text, { changeAt: ins.at, flash: ins.flash });
  commitLayout();
  await settled();
  openModelView(name);
  toast(`図「${name}」を保存しました。＋メニューの「保存された図」からいつでも開けます`);
}

/** 保存された図に要素を入れる（expose を足す）。pos があればそこに置く。入れたら true。 */
export async function addToView(e: Entry, pos?: [number, number], opts: { quiet?: boolean } = {}): Promise<boolean> {
  const mv = modelView();
  const n = S.M.nodeOf.get(e);
  if (!mv || !editableView()) return false;
  if (!n) {
    toast(`「${e.name}」は、この図には出せません`);
    return false;
  }
  if (mv.nodeKeys.includes(n.key)) {
    if (!opts.quiet) toast(`「${e.name}」は既にこの図にあります`);
    return false;
  }
  const r = await perform({ op: "addToView", view: mv.name, key: n.key });
  if (!r) return false;
  if (pos) curLayout().pos[n.key] = pos;
  setText(r.text, { changeAt: r.at, flash: r.flash });
  commitLayout();
  if (!opts.quiet) toast(`「${e.name}」をこの図に入れました`);
  return true;
}

/** 保存された図から要素を外す（その要素だけを出している expose を消す）。モデルの要素は残す。 */
export async function removeFromView(n: ModelNode): Promise<void> {
  const mv = modelView();
  if (!mv || !editableView()) return;
  const r = await perform({ op: "removeFromView", view: mv.name, key: n.key });
  if (!r) return;
  delete curLayout().pos[n.key];
  S.sel = null;
  setText(r.text, { changeAt: r.at, flash: r.flash });
  commitLayout();
  toast(`「${n.name}」をこの図から外しました（モデルには残っています）`);
}
