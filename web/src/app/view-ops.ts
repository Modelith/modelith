// 画面で図を作る操作（ADR-0005、F-VIEW-8）。利用者には「新しい図を作成する・図に入れる・図から外す」と見せ、
// テキストには標準の view と expose を書く（ADR-0014）。

import { inOpenFile, type Entry, type ModelNode, type ViewKind } from "../core";
import { type AskOption, ask } from "./dialog";
import { perform } from "./intent";
import { diagramName } from "./labels";
import { DIAGRAM_KINDS, type DiagramKind, renameViewLayout, renameViewTabs, targetCandidates } from "./diagram-kinds";
import { closeViewTabs, openModelView, saveTabs } from "./panels";
import { S } from "./state";
import { commitLayout, setText, settled, toast } from "./sync";
import { CC, curLayout, curView, modelView } from "./views";

/**
 * 自動の図から、保存する図の描き方を決める。「振る舞い」の図は、状態遷移の図（StateTransitionView）が状態定義 1 つの遷移を描くので、
 * 並べた要素をそのまま残せる一般の図（GeneralView）として保存する。
 */
const KIND_OF: Record<string, ViewKind> = { ibd: "interconnection", seq: "sequence", stm: "stateTransition", afv: "actionFlow" };

/**
 * 表示中のタブが、要素を 1 つずつ入れたり外したりできる作成した図かを判定する（F-VIEW-8）。
 * 内部ブロック図・シーケンス図・アクションの流れの図・状態遷移の図は対象の中身で決まるので対象外。
 *
 * @returns 表示中がテキストに書かれた view で、描き方が内部ブロック図（ibd）・シーケンス図（seq）・アクションの流れの図（afv）・状態遷移の図（stm）でなければ true
 * @example
 * // 作成した図「概要の図」（一般の図）を表示中のとき
 * editableView() // → true
 * // 自動の図（トレーサビリティなど）を表示中のとき
 * editableView() // → false
 */
export const editableView = (): boolean => !!modelView() && !["ibd", "seq", "afv", "stm"].includes(S.view);

/**
 * 要素を、表示中の作成した図に入れられるか（まだ入っていないか）を判定する（F-VIEW-8）。
 *
 * @param e 調べる要素（解析結果の項目）
 * @returns 表示中が編集できる作成した図で、e が図に出せる要素で、まだ入っていなければ true
 * @example
 * // 作成した図に A だけが入っているとき
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
 * @param base 名前の元（`ブロック定義図` など）
 * @returns モデルの view（S.M.views）の名前と重ならない名前
 * @example
 * // 作成した図が無いとき
 * suggestName("ブロック定義図") // → "ブロック定義図"
 * // 「ブロック定義図」と「ブロック定義図2」が既にあるとき
 * suggestName("ブロック定義図") // → "ブロック定義図3"
 */
function suggestName(base: string): string {
  const used = new Set(S.M.views.map((v) => v.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/**
 * 名前を付けて新しい図を作成する（図のメニュー・ツールバー・サイドバーの「新しい図を作成」。F-VIEW-8）。
 * 名前と図の種類をダイアログで尋ね、「今の図のまま」なら表示中の自動の図の要素と配置のまま、一般の図なら空の図を、
 * ほかの種類なら描く対象を選ばせて（無ければ新しく作って）、コアに意図 `saveView` を渡してテキストに view と expose を書く。
 * 作成した図のタブを開いてトーストで知らせる。ダイアログでやめた・コアが断ったときは何も変えない。package が無ければトーストで断る。
 */
export async function createDiagram(): Promise<void> {
  const pkg = S.P.entries.find((e) => e.kind === "package" && inOpenFile(e));
  if (!pkg) {
    toast("図を置くパッケージがありません。先に要素を追加してパッケージを作ってください");
    return;
  }
  const c = CC();
  const asIs = !S.modelView && c.nodes.length > 0;
  const options: AskOption[] = [
    ...(asIs ? [{ id: "current", label: `今の図のまま（${curView().label}）`, note: "表示中の図の要素と配置のまま作成します" }] : []),
    ...DIAGRAM_KINDS.map((k) => ({ id: k.id, label: k.label, note: k.note, confirm: k.def ? "次へ" : "作成" })),
  ];
  const first = options[0]?.id ?? "general";
  const r = await ask(
    "新しい図を作成",
    "図の名前と種類を選んでください。作成した図は、サイドバーの「図」と＋メニューの「作成した図」からいつでも開けます。",
    [
      { id: "cancel", label: "やめる" },
      { id: "ok", label: "作成", kind: "primary" },
    ],
    { value: suggestName(asIs ? diagramName(curView().label) : "新しい図"), label: "図の名前" },
    undefined,
    { label: "図の種類", value: first, options },
  );
  if (r?.id !== "ok") return;
  const name = r.value.trim();
  if (r.option === "current") return saveCurrent(name);
  const kind = DIAGRAM_KINDS.find((k) => k.id === r.option);
  if (!kind) return;
  const targets = kind.def ? await pickTarget(name, kind) : [];
  if (!targets) return;
  const ins = await perform({ op: "saveView", name, kind: kind.id, targets });
  if (!ins) return;
  setText(ins.text, { changeAt: ins.at, flash: ins.flash });
  await settled();
  openModelView(name);
  toast(kind.def ? `図「${name}」を作成しました` : `空の図「${name}」を作成しました。モデルのツリーから要素を入れてください`);
}

/**
 * 表示中の自動の図を、要素と配置のまま名前の付いた図にする（「今の図のまま」。F-VIEW-8）。
 *
 * @param name 図の名前
 */
async function saveCurrent(name: string): Promise<void> {
  const kind = KIND_OF[S.view] ?? "general";
  const c = CC();
  const targets = kind === "general" ? c.nodes.map((n) => n.key) : c.ctx ? [c.ctx.key] : [];
  const ins = await perform({ op: "saveView", name, kind, targets });
  if (!ins) return;
  // 見えている配置のまま保存する（内部ブロック図・シーケンス図・アクションの流れの図・状態遷移の図は、対象ごとの配置をそのまま使う）
  if (kind === "general") S.layout[`view:${name}`] = structuredClone(curLayout());
  setText(ins.text, { changeAt: ins.at, flash: ins.flash });
  commitLayout();
  await settled();
  openModelView(name);
  toast(`図「${name}」を作成しました。サイドバーの「図」からいつでも開けます`);
}

/**
 * 図に描く対象（定義）をダイアログで選ばせる。モデルに無ければ、新しく作る選択肢だけを出す（F-VIEW-8）。
 * 新しく作るときは、コアに意図 `addNode` を渡して定義を足し、その定義を対象にする。
 *
 * @param name 作成する図の名前（見出しに使う）
 * @param kind 図の種類（対象の定義の種類を持つもの）
 * @returns 対象のキー 1 つの配列。やめた・作れなかったときは null
 * @example
 * // 内部ブロック図で、ブロック A を選んで「作成」を押した
 * await pickTarget("Aの中", interconnection) // → ["A"]
 * // 「新しいブロックを作る」を選んだ（NewPart を足す）
 * await pickTarget("新しい図", interconnection) // → ["NewPart"]
 * // 「やめる」を押した
 * await pickTarget("新しい図", interconnection) // → null
 */
async function pickTarget(name: string, kind: DiagramKind): Promise<string[] | null> {
  const def = kind.def;
  if (!def) return [];
  const found = targetCandidates(S.M.nodes, def.kind);
  const options: AskOption[] = [
    ...found.map((n) => ({ id: `n:${n.key}`, label: n.name, note: `この${def.label}の${kind.label}にします` })),
    { id: "new", label: `新しい${def.label}を作る`, note: `新しい${def.label}を足して、その${kind.label}にします。名前はあとから変えられます`, confirm: "作って作成" },
  ];
  const r = await ask(`図「${name}」に描く${def.label}`, `${kind.label}に描く${def.label}を選んでください。`, [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "作成", kind: "primary" },
  ], undefined, undefined, { label: def.label, value: options[0]?.id ?? "new", options });
  if (r?.id !== "ok") return null;
  if (r.option.startsWith("n:")) return [r.option.slice(2)];
  const added = await perform({ op: "addNode", kind: def.kind, phase: S.phase });
  if (!added?.select) return null;
  setText(added.text, { changeAt: added.at, flash: added.flash });
  await settled();
  return [added.select];
}

/**
 * 作成した図の名前を変える（サイドバーの「図」・ツリーの右クリック。F-VIEW-11）。新しい名前をダイアログで尋ね、
 * コアに意図 `renameView` を渡してテキストの view の名前を書き換え、配置と開いているタブを新しい名前に移す。
 * やめた・同じ名前・コアが断ったときは何も変えない。
 *
 * @param name 今の図の名前
 */
export async function renameDiagram(name: string): Promise<void> {
  const r = await ask("図の名前を変更", `図「${name}」の新しい名前を入力してください。`, [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "変更", kind: "primary" },
  ], { value: name, label: "図の名前" });
  if (r?.id !== "ok") return;
  const to = r.value.trim();
  if (to === name) return;
  const ins = await perform({ op: "renameView", view: name, name: to });
  if (!ins) return;
  renameViewLayout(S.layout, name, to);
  renameViewTabs(S.tabs, name, to);
  if (S.modelView === name) S.modelView = to;
  setText(ins.text, { changeAt: ins.at, flash: ins.flash });
  commitLayout();
  saveTabs();
  toast(`図の名前を「${to}」に変えました`);
}

/**
 * 作成した図を削除する（サイドバーの「図」・ツリーの右クリック。F-VIEW-11）。確認を取ってから、コアに意図 `deleteView` を渡して
 * テキストの view の宣言を消し、図の配置を消して、その図のタブを閉じる。図に出していたモデルの要素は残す。
 *
 * @param name 図の名前
 */
export async function deleteDiagram(name: string): Promise<void> {
  const r = await ask("図を削除", `図「${name}」を削除しますか。図に出していた要素は、モデルに残ります。`, [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "削除", kind: "danger" },
  ]);
  if (r?.id !== "ok") return;
  const ins = await perform({ op: "deleteView", view: name });
  if (!ins) return;
  delete S.layout[`view:${name}`];
  setText(ins.text, { changeAt: ins.at, flash: ins.flash });
  commitLayout();
  closeViewTabs(name);
  toast(`図「${name}」を削除しました（モデルの要素は残っています）`);
}

/**
 * 表示中の作成した図に要素を入れる（F-VIEW-8）。コアに意図 `addToView` を渡して expose を足し（setText）、
 * pos があればそこに置いて配置を確定し、トーストで知らせる。
 *
 * @param e 入れる要素（解析結果の項目）
 * @param pos 置く位置（図の座標、左上）。省くと自動の配置に任せる
 * @param opts quiet が true なら、入れたとき・既にあるときのトーストを出さない（まとめて入れるとき）
 * @returns 入れたら true。編集できる作成した図でない・図に出せない要素・既に入っている・コアが断ったときは false
 * @example
 * // 作成した図（一般の図）を表示中で、B がまだ入っていないとき
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
 * 表示中の作成した図から要素を外す（F-VIEW-8）。コアに意図 `removeFromView` を渡して、その要素だけを出している expose を消し（setText）、
 * 配置から座標を消し、選択を外してトーストで知らせる。モデルの要素は残す。編集できる作成した図でない・コアが断ったときは何もしない。
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
