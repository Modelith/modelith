// 図からの編集操作。すべてテキストの書き換えとして行い、setText で反映する（ADR-0001）。

import { inOpenFile, type Entry, type ModelEdge, type ModelNode } from "../core";
import { ask } from "./dialog";
import { perform } from "./intent";
import { flowName } from "./action-flow";
import { renamedStateKeys, stateName } from "./state-machine";
import { kindLabel } from "./labels";
import { addToView, editableView } from "./view-ops";
import { shownDocName } from "./files";
import { nodeH, W } from "./geometry";
import { docLabel, renderInspector, startRename } from "./inspector";
import { attachEnds } from "./pins";
import { KW_FOR, type RelKind } from "./relations";
import { highlight, render } from "./render";
import { cancelConnect, clearSel, S } from "./state";
import { commitLayout, setText, settled, toast } from "./sync";
import { CC, curLayout, nodeByKey, phaseLabel } from "./views";
import type { Pos } from "./layout";
import { isPackageName, packageNameFor } from "./new-package";

/**
 * 定義の中で、まだ使われていない子の名前を作る。base が使われていれば、後ろに 2 から順に番号を付ける。
 *
 * @param entry 子を持つ定義（解析結果の項目）
 * @param base 名前の元
 * @returns entry の子の名前と重ならない名前
 * @example
 * // entry の子が無いとき
 * uniqueChild(entry, "part1") // → "part1"
 * // entry の子に x と x2 があるとき
 * uniqueChild(entry, "x")     // → "x3"
 */
export const uniqueChild = (entry: Entry, base: string): string => {
  let n = base, k = 2;
  while (entry.children.some((c) => c.name === n)) n = base + k++;
  return n;
};
/**
 * 解析結果（S.P）の中で最初の package を探す。
 *
 * @returns 最初の package の項目。package の無いファイルなら undefined
 * @example
 * // S.text が "package P { part def A; }" のとき
 * firstPackage() // → P の項目
 * // S.text が "part def A;" のとき
 * firstPackage() // → undefined
 */
const firstPackage = (): Entry | undefined => S.P.entries.find((e) => e.kind === "package" && inOpenFile(e));

/**
 * 表示中の内部ブロック図・シーケンス図の対象のキーを返す（コアが `u:`・`l:` のキーの要素を探す先。意図の ctx に渡す）。
 *
 * @returns 対象の定義のキー。対象の無いビュー（トレーサビリティなど）では undefined
 * @example
 * // 内部ブロック図で Kettle を対象に表示しているとき
 * ctxKey() // → "Kettle"
 * // トレーサビリティを表示しているとき
 * ctxKey() // → undefined
 */
const ctxKey = (): string | undefined => CC().ctx?.key;

/**
 * package の無いファイルで要素を置こうとしたとき、断らずに新しい package を作るよう案内する（F-EDIT-7）。
 * ダイアログで名前を尋ね（候補は表示中のファイル名から packageNameFor で作る）、名前として使えなければトーストで知らせる。
 *
 * @returns 作る package の名前（前後の空白を除く）。やめたとき・名前として使えないときは null
 * @example
 * // 表示中が untitled-1.sysml で、候補のまま「作成して配置」を押したとき
 * await askPackageName() // → "Untitled1"
 * // 名前を「2k」にしたとき
 * await askPackageName() // → null（名前の付け方をトーストで知らせる）
 * // 「やめる」を押したとき
 * await askPackageName() // → null
 */
async function askPackageName(): Promise<string | null> {
  const r = await ask(
    "パッケージを作成します",
    "要素はパッケージ（package）の中に配置します。このファイルにはまだパッケージが無いため、名前を付けて作成し、その中に配置します。",
    [
      { id: "cancel", label: "やめる" },
      { id: "ok", label: "作成して配置", kind: "primary" },
    ],
    { value: packageNameFor(shownDocName()), label: "パッケージ名" },
  );
  if (r?.id !== "ok") return null;
  const name = r.value.trim();
  if (!isPackageName(name)) {
    toast("パッケージ名は、英字か _ で始め、英字・数字・_ だけで付けてください");
    return null;
  }
  return name;
}

/** 図からの要素と関係の編集操作（コアに意図を渡し、テキストの書き換えとして反映する）。 */
export const OPS = {
  /**
   * 定義を追加し、図の pos に置く（意図 `addNode`、F-EDIT-2）。package が無ければ、作るよう案内する（F-EDIT-7）。
   * 追加した定義を選んで配置を確定し、作成した図を表示中ならその図にも入れ（F-VIEW-8）、トーストで知らせて名前の変更を始める。
   * シーケンス図でシナリオ（occurrence def）を追加したときは、それを対象にしてライフラインの追加を案内する。
   * 案内をやめた・コアが断ったときは何も変えない。
   *
   * @param kind 追加する定義の種類（`part def`・`requirement def` など）
   * @param pos 置く位置（図の座標、左上）
   */
  async addNode(kind: string, pos: Pos): Promise<void> {
    let newPackage: string | undefined;
    if (!firstPackage()) {
      const np = await askPackageName();
      if (!np) return;
      newPackage = np;
    }
    const r = await perform({ op: "addNode", kind, phase: S.phase, newPackage });
    const name = r?.select;
    if (!r || !name) return;
    if (kind === "occurrence def" && S.view === "seq") {
      S.seqCtx = name;
      setText(r.text, { changeAt: r.at, flash: r.flash });
      toast(`シナリオ「${name}」を追加しました。上のパレットの「ライフラインを追加」から登場する部品を置いてください`);
      return;
    }
    curLayout().pos[name] = pos;
    S.sel = name;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    await settled();
    // 作成した図に置いたときは、その図にも入れる（F-VIEW-8）
    const added = S.P.entries.find((e) => e.kind === kind && e.name === name);
    if (added && editableView()) await addToView(added, undefined, { quiet: true });
    toast(`${kindLabel(kind)}「${name}」を追加しました`);
    startRename();
  },

  /**
   * 内部ブロック図の部品・シーケンス図のライフラインを、表示中の対象の中に追加する（意図 `addUsage`）。
   * 追加したものを選び、内部ブロック図なら pos に置いて配置を確定し、トーストで知らせる。対象が無ければ「追加先がありません」とトーストを出す。
   *
   * @param type 部品の型（定義の名前）
   * @param pos 置く位置（図の座標、左上。内部ブロック図のときだけ使う）
   */
  async addUsage(type: string, pos: Pos): Promise<void> {
    const c = CC();
    if (!c.ctx) {
      toast("追加先がありません");
      return;
    }
    const r = await perform({ op: "addUsage", ctx: c.ctx.key, type });
    const nm = r?.select;
    if (!r || !nm) return;
    if (S.view === "ibd") curLayout().pos["u:" + nm] = pos;
    clearSel();
    S.sel = (S.view === "ibd" ? "u:" : "l:") + nm;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    if (S.view === "ibd") commitLayout();
    toast(`${c.ctx.name} に部品「${nm}」（${type}）を追加しました`);
  },

  /**
   * 属性を足すか書き換える（意図 `setAttribute`、F-EDIT-12）。書いたらトーストで知らせる。
   *
   * @param n 属性を持つ定義
   * @param attr 書き換える属性の今の名前（足すときは null）
   * @param name 新しい名前
   * @param type 型（空なら書かない）
   * @param value 値（空なら書かない）
   * @returns 書いたなら true。コアが断った（名前が空・既にある名前・使えない文字など）なら false
   * @example
   * await OPS.setAttribute(A, null, "mass", "Real", "1500") // → true（attribute mass : Real = 1500; を足す）
   * await OPS.setAttribute(A, "mass", "mass", "", "")        // → true（型と値を消す）
   */
  async setAttribute(n: ModelNode, attr: string | null, name: string, type: string, value: string): Promise<boolean> {
    const r = await perform({ op: "setAttribute", key: n.key, ...(attr === null ? {} : { attr }), name, type, value, ctx: ctxKey() });
    if (!r) return false;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast(attr === null ? `「${n.name}」に属性「${name.trim()}」を足しました` : `属性「${name.trim()}」を書き換えました`);
    return true;
  },

  /**
   * 属性を消す（意図 `removeAttribute`、F-EDIT-12）。消したらトーストで知らせる。
   *
   * @param n 属性を持つ定義
   * @param attr 消す属性の名前
   * @returns 消したなら true。コアが断ったなら false
   * @example
   * await OPS.removeAttribute(A, "mass") // → true（attribute mass … ; の行が消える）
   */
  async removeAttribute(n: ModelNode, attr: string): Promise<boolean> {
    const r = await perform({ op: "removeAttribute", key: n.key, attr, ctx: ctxKey() });
    if (!r) return false;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast(`属性「${attr}」を消しました`);
    return true;
  },

  /**
   * 要素の説明（要求なら要求の文章。テキストの doc）を書き換える（意図 `setDoc`、F-EDIT-12）。空なら説明を消す。
   * 書き換えたらトーストで知らせる。
   *
   * @param n 説明を書き換える要素
   * @param text 新しい説明の文（前後の空白は除く）
   * @returns 書き換えた（または同じ文で変える必要が無かった）なら true。コアが断ったなら false
   * @example
   * // requirement def R { doc /* 古い *\/ } があるとき
   * await OPS.setDoc(R, "3 分で沸かす") // → true（テキストの doc が変わる）
   * await OPS.setDoc(R, "古い")          // → true（何も変えない）
   */
  async setDoc(n: ModelNode, text: string): Promise<boolean> {
    if (text.trim() === (n.entry.doc ?? "")) return true;
    const r = await perform({ op: "setDoc", key: n.key, text, ctx: ctxKey() });
    if (!r) return false;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast(text.trim() ? `「${n.name}」の${docLabel(n)}を変えました` : `「${n.name}」の${docLabel(n)}を消しました`);
    return true;
  },

  /**
   * 名前を変え、参照と配置情報もまとめて書き換える（意図 `rename`、F-EDIT-3）。
   * すべてのビューの座標・接続点・線の端のキーを新しい名前に付け替え（`u:`・`l:` は付けたまま。状態遷移の図の状態は、中の要素のキーも）、
   * 選び直して配置を確定し、トーストで知らせる。
   *
   * @param n 名前を変える要素
   * @param nn 新しい名前（SysML v2 の基本名）
   * @returns 変えた（または同じ名前で変える必要が無かった）なら true。コアが断った（使えない名前・既に使われている名前など）なら false
   * @example
   * // part def A があるとき
   * await OPS.rename(A, "Motor") // → true（テキストの A と参照が Motor に変わる）
   * await OPS.rename(A, "A")     // → true（何も変えない）
   * await OPS.rename(A, "B")     // → false（B が既にあるとき。理由をトーストで出す）
   */
  async rename(n: ModelNode, nn: string): Promise<boolean> {
    if (nn === n.name) return true;
    const r = await perform({ op: "rename", key: n.key, name: nn, ctx: ctxKey() });
    if (!r) return false;
    // 図の要素のキーも名前に合わせて変える（内部ブロック図の部品・ライフラインは u:・l: を付けたまま。状態は中の要素のキーも変える）
    const nk = (/^[ul]:/.exec(n.key)?.[0] ?? "") + nn;
    const moves = n.state ? renamedStateKeys(n.key, nn, CC().nodes.map((x) => x.key)) : [[n.key, nk] as [string, string]];
    for (const [ok, newKey] of moves) {
      for (const v of Object.values(S.layout)) {
        const pos = v.pos[ok];
        if (pos) {
          v.pos[newKey] = pos;
          delete v.pos[ok];
        }
        const pv = v.pins[ok];
        if (pv) {
          v.pins[newKey] = pv;
          delete v.pins[ok];
        }
        for (const [k, val] of Object.entries(v.ends)) {
          const parts = k.split("|");
          if (parts[1] === ok || parts[2] === ok) {
            v.ends[parts.map((s, i) => ((i === 1 || i === 2) && s === ok ? newKey : s)).join("|")] = val;
            delete v.ends[k];
          }
        }
      }
    }
    S.sel = moves[0]?.[1] ?? nk;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(`「${n.name}」を「${nn}」に変更しました。使っている箇所もまとめて変えました`);
    return true;
  },

  /**
   * 要素をテキストから削除する（意図 `delete`）。すべてのビューからその座標を消し、選択を外して配置を確定し、トーストで知らせる。
   * コアが断ったときは何も変えない。
   *
   * @param n 削除する要素
   */
  async deleteNode(n: ModelNode): Promise<void> {
    const r = await perform({ op: "delete", keys: [n.key], ctx: ctxKey() });
    if (!r) return;
    for (const v of Object.values(S.layout)) delete v.pos[n.key];
    S.sel = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(n.note ? "メモを削除しました" : `「${n.flow ? flowName(n) : n.state ? stateName(n) : n.name}」を削除しました`);
  },

  /**
   * 関係（線）をテキストから削除する（意図 `deleteEdge`）。線の選択を外し、トーストで知らせる。コアが断ったときは何も変えない。
   * メモの線（annotate）は削除せず、メモごと削除するよう案内する。
   *
   * @param ed 削除する関係
   */
  async deleteEdge(ed: ModelEdge): Promise<void> {
    if (ed.kind === "annotate") {
      toast("メモの線だけは削除できません。メモを選んで削除してください");
      return;
    }
    const r = await perform({ op: "deleteEdge", id: ed.id, ctx: ctxKey() });
    if (!r) return;
    S.selEdge = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast("関係を削除しました");
  },

  /**
   * a から b への関係を追加する（意図 `connect`、F-EDIT-2）。接続モードを終え、テキストを書き換え、追加した関係をトーストで知らせる。
   * 線を描いて追加した場合は、端がポートならそのポートどうしをつなぎ、その端の位置も接続点として配置に記録する。コアが断ったときは何も変えない。
   *
   * @param a 関係の元の要素
   * @param b 関係の先の要素
   * @param rel 関係の種類（`comp`・`satisfy`・`verify`・`frame`・`derive`・`flow`・`succession`・`transition`。relOptions が返したもの）
   */
  async connect(a: ModelNode, b: ModelNode, rel: RelKind): Promise<void> {
    const wire = S.wire;
    const portOf = (sp: { pin: string | null } | null | undefined): string | null => (sp?.pin?.startsWith("port:") ? sp.pin.slice(5) : null);
    const r = await perform({ op: "connect", rel, from: a.key, to: b.key, fromPort: wire ? portOf(wire.from) : null, toPort: wire ? portOf(wire.to) : null, ctx: ctxKey() });
    const what = {
      comp: `「${a.name} が ${b.name} を${kindLabel(KW_FOR[b.kind] ?? "part")}として持つ」`,
      satisfy: `「${a.name} が ${b.name} を満たす」`,
      verify: `「${a.name} で ${b.name} を検証する」`,
      frame: `「${a.name} が関心事 ${b.name} を扱う」`,
      derive: `「${a.name} を ${b.name} から導出する」`,
      flow: `「${a.name} から ${b.name} への流れ」`,
      succession: `「${flowName(a)} の後に ${flowName(b)}」の順序`,
      transition: `「${stateName(a)} から ${stateName(b)} へ」の遷移`,
    }[rel];
    if (!r) return;
    const before = new Set([...S.M.edges, ...CC().edges].map((e) => e.id));
    cancelConnect();
    setText(r.text, { changeAt: r.at, flash: r.flash });
    await settled();
    if (wire && wire.to) {
      const ne = [...CC().edges, ...S.M.edges].find((e) => !before.has(e.id) && e.kind === rel && e.from === a.key && e.to === b.key);
      if (ne) {
        const fl = S.flash;
        attachEnds(ne.id, wire);
        setText(S.text, { changeAt: S.text.length, flash: fl });
        commitLayout();
      }
    }
    toast(`${what}を追加しました`);
  },
};

/** シーケンス図のメッセージの操作。 */
export const MSGOPS = {
  /**
   * 表示中のシーケンス図に、fromKey から toKey へのメッセージを追加する（意図 `addMessage`）。
   * 追加したメッセージを選んで名前の編集を始め、描き直してトーストで知らせる。対象が無い・コアが断ったときは何もしない。
   *
   * @param fromKey 送り手のライフラインのキー（`l:名前`）
   * @param toKey 受け手のライフラインのキー（`l:名前`。送り手と同じなら自分自身へのメッセージ）
   */
  async add(fromKey: string, toKey: string): Promise<void> {
    const ctx = CC().ctx?.key;
    const r = ctx ? await perform({ op: "addMessage", ctx, from: fromKey, to: toKey }) : null;
    const nm = r?.select;
    if (!r || !nm) return;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    await settled();
    const ne = CC().edges.find((e) => e.label === nm);
    clearSel();
    if (ne) {
      S.selEdge = ne.id;
      S.msgEdit = true;
    }
    render();
    highlight();
    renderInspector();
    toast(`メッセージ「${nm}」を追加しました`);
  },

  /**
   * メッセージの名前と型を書き換える（意図 `updateMessage`）。書き換えた後も同じ順番のメッセージを選び直して描き直す。
   *
   * @param e 書き換えるメッセージ
   * @param name 新しい名前
   * @param type 新しい型の名前（空文字列なら型を書かない）
   * @returns 書き換えたら true。対象が無い・コアが断ったときは false
   * @example
   * // シーケンス図にメッセージ ping があるとき
   * await MSGOPS.update(ping, "pong", "Signal") // → true
   * // 対象の無いビューで呼んだとき
   * await MSGOPS.update(ping, "pong", "")       // → false
   */
  async update(e: ModelEdge, name: string, type: string): Promise<boolean> {
    const ctx = CC().ctx?.key;
    const r = ctx ? await perform({ op: "updateMessage", ctx, id: e.id, name, type }) : null;
    if (!r) return false;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    await settled();
    const ne = CC().edges[e.idx ?? -1];
    if (ne) S.selEdge = ne.id;
    render();
    renderInspector();
    return true;
  },

  /**
   * メッセージの順番を 1 つ前か後ろと入れ替える（意図 `moveMessage`。文を入れ替え、then の有無は位置に残す）。
   * 動かした先のメッセージを選び直して描き直す。対象が無い・コアが断ったときは何もしない。
   *
   * @param e 動かすメッセージ
   * @param dir 動かす向き（-1 は前へ、1 は後ろへ）
   */
  async move(e: ModelEdge, dir: -1 | 1): Promise<void> {
    const ctx = CC().ctx?.key;
    const r = ctx ? await perform({ op: "moveMessage", ctx, id: e.id, dir }) : null;
    if (!r) return;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    await settled();
    const ne = CC().edges[(e.idx ?? 0) + dir];
    if (ne) S.selEdge = ne.id;
    render();
    highlight();
    renderInspector();
  },
};

/** フェーズ（@Phase メタデータ）の操作。 */
export const PHASEOPS = {
  /**
   * 要素のフェーズ（工程）を設定する（意図 `setPhase`、F-TRACE-1）。value が空なら、その要素に書いた指定を外す。
   * テキストを書き換えてトーストで知らせる。コアが断ったときはインスペクタを描き直して選択欄を元に戻す。
   *
   * @param n フェーズを設定する要素
   * @param value フェーズの列挙値の名前（空文字列なら指定を外す）
   */
  async set(n: ModelNode, value: string): Promise<void> {
    const r = await perform({ op: "setPhase", keys: [n.key], value, ctx: ctxKey() });
    if (!r) {
      renderInspector();
      return;
    }
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast(value ? `${n.name} を「${phaseLabel(value)}」にしました` : `${n.name} のフェーズ指定を外しました`);
  },

  /**
   * フェーズの定義（metadata def と enum def）を最初の package に足す（意図 `initPhases`、F-TRACE-1）。package が無ければ、作るよう案内する（F-EDIT-7）。
   * テキストを書き換えてトーストで知らせる。案内をやめた・コアが断ったときは何も変えない。
   */
  async init(): Promise<void> {
    let newPackage: string | undefined;
    if (!firstPackage()) {
      const np = await askPackageName();
      if (!np) return;
      newPackage = np;
    }
    const r = await perform({ op: "initPhases", newPackage });
    if (!r) return;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast("フェーズの定義を追加しました。要素を選んでフェーズを設定できます");
  },
};

/* ---- 複数選択 ---- */
/**
 * 選択を、渡した要素の組に置き換える（ほかの選択と一時的な操作状態はすべて外す）。描き直しは呼び出し側で行う。
 *
 * @param keys 選ぶ要素のキー（空なら何も選ばない）
 * @param primary 主に選ぶ要素のキー（インスペクタに出す）。省くと keys の最後
 */
export function setSelection(keys: string[], primary?: string): void {
  clearSel();
  S.selSet = new Set(keys);
  S.sel = primary ?? keys[keys.length - 1] ?? null;
}

/**
 * 選択中の要素（S.selSet）を、図の要素にして返す。見つからないキーは除く。
 *
 * @returns 選択中の要素（選んだ順）。何も選んでいなければ空の配列
 * @example
 * // A と B を選んでいるとき
 * selNodes() // → [A, B]
 * // 何も選んでいないとき
 * selNodes() // → []
 */
export const selNodes = (): ModelNode[] => [...S.selSet].flatMap((k) => nodeByKey(k) ?? []);

/**
 * 要素を選択の組に足す、または組から外す（Shift ＋クリック）。主に選ぶ要素は組の最後のものにし、
 * 線・接続点・ツリー・テキストの印の選択は外して、図・テキスト・インスペクタを描き直す。
 *
 * @param key 足す・外す要素のキー
 */
export function toggleSel(key: string): void {
  if (S.selSet.has(key)) S.selSet.delete(key);
  else S.selSet.add(key);
  S.sel = [...S.selSet].pop() ?? null;
  S.selEdge = null;
  S.selPin = null;
  S.treeSel = null;
  S.textMark = null;
  render();
  highlight();
  renderInspector();
}

export type AlignMode = "left" | "top" | "hspace" | "vspace";

/**
 * 選んだ要素を揃える・等間隔に並べる（座標は必ずある前提で呼ぶ）。L を書き換える。
 * left・top は最も左・上に揃え、hspace は左から W + 60（284）ずつ、vspace は上から要素の高さ + 60 ずつ間を空けて並べる。
 *
 * @param mode 揃え方（`left`：左揃え、`top`：上揃え、`hspace`：横に等間隔、`vspace`：縦に等間隔）
 * @param ns 揃える要素
 * @param L ビューの座標（要素のキー → 左上の座標）。書き換える
 */
export function align(mode: AlignMode, ns: ModelNode[], L: Record<string, Pos>): void {
  const at = (n: ModelNode): Pos => L[n.key] ?? [0, 0];
  if (mode === "left") {
    const x = Math.min(...ns.map((n) => at(n)[0]));
    for (const n of ns) L[n.key] = [x, at(n)[1]];
  } else if (mode === "top") {
    const y = Math.min(...ns.map((n) => at(n)[1]));
    for (const n of ns) L[n.key] = [at(n)[0], y];
  } else if (mode === "hspace") {
    const s = [...ns].sort((a, b) => at(a)[0] - at(b)[0]);
    const x0 = s[0] ? at(s[0])[0] : 0;
    s.forEach((n, i) => (L[n.key] = [x0 + i * (W + 60), at(n)[1]]));
  } else {
    const s = [...ns].sort((a, b) => at(a)[1] - at(b)[1]);
    let y = s[0] ? at(s[0])[1] : 0;
    for (const n of s) {
      L[n.key] = [at(n)[0], y];
      y += nodeH(n) + 60;
    }
  }
}

/**
 * 選択中の要素のうち、表示中のビューに座標のあるものを揃え、配置を確定してトーストで知らせる（F-VIEW-4）。
 * 2 個未満なら揃えず、「2 個以上選ぶと整列できます」とトーストを出す。
 *
 * @param mode 揃え方（`left`・`top`・`hspace`・`vspace`）
 */
export function alignSel(mode: AlignMode): void {
  const L = curLayout().pos;
  const ns = selNodes().filter((n) => L[n.key]);
  if (ns.length < 2) {
    toast("2 個以上選ぶと整列できます");
    return;
  }
  align(mode, ns, L);
  commitLayout();
  toast(`${ns.length} 個を整列しました`);
}

/**
 * 選択中の要素をテキストから削除する（意図 `delete`）。1 個なら OPS.deleteNode と同じ。複数ならまとめて削除し、
 * すべてのビューから座標を消して選択を外し、配置を確定してトーストで知らせる。何も選んでいない・コアが断ったときは何もしない。
 */
export async function deleteSel(): Promise<void> {
  const ns = selNodes();
  const only = ns[0];
  if (!only) return;
  if (ns.length === 1) {
    await OPS.deleteNode(only);
    return;
  }
  const r = await perform({ op: "delete", keys: ns.map((n) => n.key), ctx: ctxKey() });
  if (!r) return;
  for (const n of ns) for (const v of Object.values(S.layout)) delete v.pos[n.key];
  clearSel();
  setText(r.text, { changeAt: r.at, flash: r.flash });
  commitLayout();
  toast(`${ns.length} 個の定義をテキストから削除しました`);
}

/**
 * 選択中の定義のフェーズをまとめて設定する（意図 `setPhase`、F-TRACE-1）。1 個なら PHASEOPS.set と同じ。
 * 定義を選んでいない・フェーズの定義が無い・コアが断ったときは何もしない。
 *
 * @param value フェーズの列挙値の名前（空文字列なら指定を外す）
 */
export async function setPhaseSel(value: string): Promise<void> {
  const ns = selNodes().filter((n) => n.isDef);
  const only = ns[0];
  if (!only || !S.M.phases) return;
  if (ns.length === 1) {
    await PHASEOPS.set(only, value);
    return;
  }
  const r = await perform({ op: "setPhase", keys: ns.map((n) => n.key), value, ctx: ctxKey() });
  if (!r) return;
  setText(r.text, { changeAt: r.at, flash: r.flash });
  toast(`${ns.length} 個を「${phaseLabel(value)}」にしました`);
}
