// 図からの編集操作。すべてテキストの書き換えとして行い、setText で反映する（ADR-0001）。

import type { Entry, ModelEdge, ModelNode } from "../core";
import { ask } from "./dialog";
import { perform } from "./intent";
import { kindLabel } from "./labels";
import { addToView, editableView } from "./view-ops";
import { shownDocName } from "./files";
import { nodeH, W } from "./geometry";
import { renderInspector, startRename } from "./inspector";
import { attachEnds } from "./pins";
import { KW_FOR, type RelKind } from "./relations";
import { highlight, render } from "./render";
import { cancelConnect, clearSel, S } from "./state";
import { commitLayout, setText, settled, toast } from "./sync";
import { CC, curLayout, nodeByKey, phaseLabel } from "./views";
import type { Pos } from "./layout";
import { isPackageName, packageNameFor } from "./new-package";

export const uniqueChild = (entry: Entry, base: string): string => {
  let n = base, k = 2;
  while (entry.children.some((c) => c.name === n)) n = base + k++;
  return n;
};
const firstPackage = (): Entry | undefined => S.P.entries.find((e) => e.kind === "package");

/** 内部ブロック図・シーケンス図の対象のキー（`u:`・`l:` のキーの要素を探す先）。 */
const ctxKey = (): string | undefined => CC().ctx?.key;

/**
 * package の無いファイルで要素を置こうとしたとき、断らずに新しい package を作るよう案内する（F-EDIT-7）。
 * 作るなら package の名前を返す（やめたら null）。
 */
async function askPackageName(): Promise<string | null> {
  const r = await ask(
    "モデルの入れ物を作ります",
    "要素は、モデルの入れ物（package）の中に置きます。このファイルにはまだ入れ物が無いので、名前を付けて作り、その中に置きます。",
    [
      { id: "cancel", label: "やめる" },
      { id: "ok", label: "作って置く", kind: "primary" },
    ],
    { value: packageNameFor(shownDocName()), label: "入れ物の名前" },
  );
  if (r?.id !== "ok") return null;
  const name = r.value.trim();
  if (!isPackageName(name)) {
    toast("入れ物の名前は、英字か _ で始め、英字・数字・_ だけで付けてください");
    return null;
  }
  return name;
}

export const OPS = {
  /** 定義を追加し、図の pos に置く。package が無ければ、作るよう案内する。 */
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
    // 保存された図に置いたときは、その図にも入れる（F-VIEW-8）
    const added = S.P.entries.find((e) => e.kind === kind && e.name === name);
    if (added && editableView()) await addToView(added, undefined, { quiet: true });
    toast(`${kindLabel(kind)}「${name}」を追加しました`);
    startRename();
  },

  /** 内部ブロック図の部品・シーケンス図のライフラインを追加する。 */
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

  /** 名前を変え、参照と配置情報もまとめて書き換える。 */
  async rename(n: ModelNode, nn: string): Promise<boolean> {
    if (nn === n.name) return true;
    const r = await perform({ op: "rename", key: n.key, name: nn, ctx: ctxKey() });
    if (!r) return false;
    // 図の要素のキーも名前に合わせて変える（内部ブロック図の部品・ライフラインは u:・l: を付けたまま）
    const nk = (/^[ul]:/.exec(n.key)?.[0] ?? "") + nn;
    for (const v of Object.values(S.layout)) {
      const pos = v.pos[n.key];
      if (pos) {
        v.pos[nk] = pos;
        delete v.pos[n.key];
      }
      const pv = v.pins[n.key];
      if (pv) {
        v.pins[nk] = pv;
        delete v.pins[n.key];
      }
      for (const [k, val] of Object.entries(v.ends)) {
        const parts = k.split("|");
        if (parts[1] === n.key || parts[2] === n.key) {
          v.ends[parts.map((s, i) => ((i === 1 || i === 2) && s === n.key ? nk : s)).join("|")] = val;
          delete v.ends[k];
        }
      }
    }
    S.sel = nk;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(`「${n.name}」を「${nn}」に変更しました。使っている箇所もまとめて変えました`);
    return true;
  },

  async deleteNode(n: ModelNode): Promise<void> {
    const r = await perform({ op: "delete", keys: [n.key], ctx: ctxKey() });
    if (!r) return;
    for (const v of Object.values(S.layout)) delete v.pos[n.key];
    S.sel = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(`「${n.name}」を削除しました`);
  },

  async deleteEdge(ed: ModelEdge): Promise<void> {
    const r = await perform({ op: "deleteEdge", id: ed.id, ctx: ctxKey() });
    if (!r) return;
    S.selEdge = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast("関係を削除しました");
  },

  /** a から b への関係を追加する。線を描いて追加した場合は、その端の位置も記録する。 */
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

  /** メッセージの順番を入れ替える（文を入れ替え、then の有無は位置に残す）。 */
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
  /** 要素のフェーズを設定する。value が空なら、その要素に書いた指定を外す。 */
  async set(n: ModelNode, value: string): Promise<void> {
    const r = await perform({ op: "setPhase", keys: [n.key], value, ctx: ctxKey() });
    if (!r) {
      renderInspector();
      return;
    }
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast(value ? `${n.name} を「${phaseLabel(value)}」にしました` : `${n.name} のフェーズ指定を外しました`);
  },

  /** フェーズの定義（metadata def と enum def）を最初の package に足す。package が無ければ、作るよう案内する。 */
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
export function setSelection(keys: string[], primary?: string): void {
  clearSel();
  S.selSet = new Set(keys);
  S.sel = primary ?? keys[keys.length - 1] ?? null;
}

export const selNodes = (): ModelNode[] => [...S.selSet].flatMap((k) => nodeByKey(k) ?? []);

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

/** 選んだ要素を揃える・等間隔に並べる（座標は必ずある前提で呼ぶ）。 */
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

/** 選んだ定義のフェーズをまとめて設定する。 */
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
