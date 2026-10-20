// 画面で図を作る操作（ADR-0005、F-VIEW-8）。利用者には「図を保存する・図に入れる・図から外す」と見せ、
// テキストには標準の view と expose を書く（ADR-0014）。

import type { Entry, ModelNode, ViewKind } from "../core";
import { ask } from "./dialog";
import { perform } from "./intent";
import { openModelView } from "./panels";
import { S } from "./state";
import { commitLayout, setText, settled, toast } from "./sync";
import { CC, curLayout, curView, modelView } from "./views";

/**
 * 自動の図から、保存する図の描き方を決める。「振る舞い」の図は、状態遷移の図（StateTransitionView）が状態定義 1 つの遷移を描くので、
 * 並べた要素をそのまま残せる一般の図（GeneralView）として保存する。
 */
const KIND_OF: Record<string, ViewKind> = { ibd: "interconnection", seq: "sequence", stm: "stateTransition", afv: "actionFlow" };

/**
 * 表示中のタブが、要素を 1 つずつ入れたり外したりできる保存された図かを判定する（F-VIEW-8）。
 * 内部ブロック図・シーケンス図・アクションの流れの図・状態遷移の図は対象の中身で決まるので対象外。
 *
 * @returns 表示中がテキストに書かれた view で、描き方が内部ブロック図（ibd）・シーケンス図（seq）・アクションの流れの図（afv）・状態遷移の図（stm）でなければ true
 * @example
 * // 保存された図「概要の図」（一般の図）を表示中のとき
 * editableView() // → true
 * // 自動の図（トレーサビリティなど）を表示中のとき
 * editableView() // → false
 */
export const editableView = (): boolean => !!modelView() && !["ibd", "seq", "afv", "stm"].includes(S.view);

/**
 * 要素を、表示中の保存された図に入れられるか（まだ入っていないか）を判定する（F-VIEW-8）。
 *
 * @param e 調べる要素（解析結果の項目）
 * @returns 表示中が編集できる保存された図で、e が図に出せる要素で、まだ入っていなければ true
 * @example
 * // 保存された図に A だけが入っているとき
 * canAddToView(B) // → true
 * canAddToView(A) // → false（既に入っている）
 * // 自動の図を表示中のとき
 * canAddToView(B) // → false
 */
export function canAddToView(e: Entry): boolean {
  const n = S.M.nodeOf.get(e);
  return editableView() && !!n && !(modelView()?.nodeKeys.includes(n.key) ?? false);
}

/**
 * まだ使われていない図の名前の候補を作る。base が使われていれば、後ろに 2 から順に番号を付ける。
 *
 * @param base 名前の元（`構造の図` など）
 * @returns モデルの view（S.M.views）の名前と重ならない名前
 * @example
 * // 保存された図が無いとき
 * suggestName("構造の図") // → "構造の図"
 * // 「構造の図」と「構造の図2」が既にあるとき
 * suggestName("構造の図") // → "構造の図3"
 */
function suggestName(base: string): string {
  const used = new Set(S.M.views.map((v) => v.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/**
 * 表示中の自動の図を、名前を付けて保存する（F-VIEW-8）。名前をダイアログで尋ね、コアに意図 `saveView` を渡して
 * テキストに view と expose を書き（setText）、見えている配置を写して配置を確定し、保存した図のタブを開いてトーストで知らせる。
 * 既に保存された図を表示中なら何もしない。package か図の要素が無ければトーストで断る。ダイアログでやめた・コアが断ったときは何も変えない。
 */
export async function saveAsView(): Promise<void> {
  if (S.modelView) return;
  const pkg = S.P.entries.find((e) => e.kind === "package");
  const kind = KIND_OF[S.view] ?? "general";
  const c = CC();
  const targets = kind === "general" ? c.nodes.map((n) => n.key) : c.ctx ? [c.ctx.key] : [];
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
  // 見えている配置のまま保存する（内部ブロック図・シーケンス図・アクションの流れの図・状態遷移の図は、対象ごとの配置をそのまま使う）
  if (kind === "general") S.layout[`view:${name}`] = structuredClone(curLayout());
  setText(ins.text, { changeAt: ins.at, flash: ins.flash });
  commitLayout();
  await settled();
  openModelView(name);
  toast(`図「${name}」を保存しました。＋メニューの「保存された図」からいつでも開けます`);
}

/**
 * 表示中の保存された図に要素を入れる（F-VIEW-8）。コアに意図 `addToView` を渡して expose を足し（setText）、
 * pos があればそこに置いて配置を確定し、トーストで知らせる。
 *
 * @param e 入れる要素（解析結果の項目）
 * @param pos 置く位置（図の座標、左上）。省くと自動の配置に任せる
 * @param opts quiet が true なら、入れたとき・既にあるときのトーストを出さない（まとめて入れるとき）
 * @returns 入れたら true。編集できる保存された図でない・図に出せない要素・既に入っている・コアが断ったときは false
 * @example
 * // 保存された図（一般の図）を表示中で、B がまだ入っていないとき
 * await addToView(B, [100, 80]) // → true（テキストに expose が足され、(100, 80) に置かれる）
 * await addToView(B)            // → false（既にこの図にある、とトースト）
 */
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

/**
 * 表示中の保存された図から要素を外す（F-VIEW-8）。コアに意図 `removeFromView` を渡して、その要素だけを出している expose を消し（setText）、
 * 配置から座標を消し、選択を外してトーストで知らせる。モデルの要素は残す。編集できる保存された図でない・コアが断ったときは何もしない。
 *
 * @param n 外す要素（図の要素）
 */
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
