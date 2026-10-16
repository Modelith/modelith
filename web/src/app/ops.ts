// 図からの編集操作。すべてテキストの書き換えとして行い、setText で反映する（ADR-0001）。

import {
  applyEdits, applyTextEdits, edit, indentAt, insertEdit, insertInto, removeRange, type Edit, type Entry, type Intent, type ModelEdge, type ModelNode,
} from "../core";
import { ask } from "./dialog";
import { kindLabel } from "./labels";
import { addToView, editableView } from "./view-ops";
import { shownDocName } from "./files";
import { nodeH, W } from "./geometry";
import { renderInspector, startRename } from "./inspector";
import { attachEnds } from "./pins";
import { KW_FOR, type RelKind } from "./relations";
import { highlight, render } from "./render";
import { cancelConnect, clearSel, S } from "./state";
import { commitLayout, setText, toast } from "./sync";
import { CC, curLayout, nodeByKey, phaseLabel } from "./views";
import type { Pos } from "./layout";
import { appendPackage, isPackageName, packageNameFor } from "./new-package";

const NAME_RE = /^[A-Za-z_]\w*$/;
export const uniqueChild = (entry: Entry, base: string): string => {
  let n = base, k = 2;
  while (entry.children.some((c) => c.name === n)) n = base + k++;
  return n;
};
const firstPackage = (): Entry | undefined => S.P.entries.find((e) => e.kind === "package");

/** 内部ブロック図・シーケンス図の対象のキー（`u:`・`l:` のキーの要素を探す先）。 */
const ctxKey = (): string | undefined => CC().ctx?.key;

/** 図の操作の結果（編集を当てたテキストと、変わり始めの位置）。 */
interface Performed {
  text: string;
  at: number;
  select?: string;
  flash?: [number, number];
}

/** 意図をコアに渡し、返ってきた編集をテキストに当てる（ADR-0016）。操作できなければ理由を知らせて null。 */
function perform(intent: Intent): Performed | null {
  const r = edit(S.text, intent);
  if ("refused" in r) {
    toast(r.refused);
    return null;
  }
  return { text: applyTextEdits(S.text, r.edits), at: r.edits[0]?.start ?? 0, select: r.select, flash: r.flash };
}

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
    const r = perform({ op: "addNode", kind, phase: S.phase, newPackage });
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
    // 保存された図に置いたときは、その図にも入れる（F-VIEW-8）
    const added = S.P.entries.find((e) => e.kind === kind && e.name === name);
    if (added && editableView()) addToView(added, undefined, { quiet: true });
    toast(`${kindLabel(kind)}「${name}」を追加しました`);
    startRename();
  },

  /** 内部ブロック図の部品・シーケンス図のライフラインを追加する。 */
  addUsage(type: string, pos: Pos): void {
    const c = CC();
    if (!c.ctx) {
      toast("追加先がありません");
      return;
    }
    const r = perform({ op: "addUsage", ctx: c.ctx.key, type });
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
  rename(n: ModelNode, nn: string): boolean {
    if (nn === n.name) return true;
    const r = perform({ op: "rename", key: n.key, name: nn, ctx: ctxKey() });
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

  deleteNode(n: ModelNode): void {
    const r = perform({ op: "delete", keys: [n.key], ctx: ctxKey() });
    if (!r) return;
    for (const v of Object.values(S.layout)) delete v.pos[n.key];
    S.sel = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(`「${n.name}」を削除しました`);
  },

  deleteEdge(ed: ModelEdge): void {
    const r = perform({ op: "deleteEdge", id: ed.id, ctx: ctxKey() });
    if (!r) return;
    S.selEdge = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast("関係を削除しました");
  },

  /** a から b への関係を追加する。線を描いて追加した場合は、その端の位置も記録する。 */
  connect(a: ModelNode, b: ModelNode, rel: RelKind): void {
    const wire = S.wire;
    const portOf = (sp: { pin: string | null } | null | undefined): string | null => (sp?.pin?.startsWith("port:") ? sp.pin.slice(5) : null);
    const r = perform({ op: "connect", rel, from: a.key, to: b.key, fromPort: wire ? portOf(wire.from) : null, toPort: wire ? portOf(wire.to) : null, ctx: ctxKey() });
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
  add(fromKey: string, toKey: string): void {
    const c = CC();
    if (!c.ctx) return;
    const a = fromKey.slice(2), b = toKey.slice(2);
    const used = new Set(c.edges.map((e) => e.label));
    let k = c.edges.length + 1;
    let nm = "msg" + k;
    while (used.has(nm)) nm = "msg" + ++k;
    const last = c.edges[c.edges.length - 1];
    const useThen = !!last && /^then\s/.test(S.text.slice(last.src.start));
    const r = insertInto(S.text, c.ctx.entry, `${useThen ? "then " : ""}message ${nm} from ${a} to ${b};`);
    setText(r.text, { changeAt: r.at, flash: [r.at, r.at + r.len] });
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

  update(e: ModelEdge, name: string, type: string): boolean {
    if (name && !NAME_RE.test(name)) {
      toast("名前は英字か _ で始め、英字・数字・_ だけで付けてください");
      return false;
    }
    const r = e.rel;
    if (!r || r.rel !== "message") return false;
    const old = S.text.slice(e.src.start, e.src.end);
    const then = /^then\s/.test(old) ? "then " : "";
    const ns = `${then}message ${name ? name + " " : ""}${type ? "of " + type + " " : ""}from ${r.a} to ${r.b};`;
    setText(S.text.slice(0, e.src.start) + ns + S.text.slice(e.src.end), { changeAt: e.src.start, flash: [e.src.start, e.src.start + ns.length] });
    const ne = CC().edges[e.idx ?? -1];
    if (ne) S.selEdge = ne.id;
    render();
    renderInspector();
    return true;
  },

  /** メッセージの順番を入れ替える（文を入れ替え、then の有無は位置に残す）。 */
  move(e: ModelEdge, dir: -1 | 1): void {
    const c = CC();
    const i = e.idx ?? 0;
    const o = c.edges[i + dir];
    if (!o) return;
    const [A, B] = dir < 0 ? [o, e] : [e, o];
    const t = S.text;
    const ta = t.slice(A.src.start, A.src.end), tb = t.slice(B.src.start, B.src.end);
    const pre = (s: string): string => /^then\s+/.exec(s)?.[0] ?? "";
    const strip = (s: string): string => s.replace(/^then\s+/, "");
    const na = pre(ta) + strip(tb), nb = pre(tb) + strip(ta);
    const nt = t.slice(0, A.src.start) + na + t.slice(A.src.end, B.src.start) + nb + t.slice(B.src.end);
    setText(nt, { changeAt: A.src.start, flash: [A.src.start, B.src.end + (na.length - ta.length) + (nb.length - tb.length)] });
    const ne = CC().edges[i + dir];
    if (ne) S.selEdge = ne.id;
    render();
    highlight();
    renderInspector();
  },
};

/** フェーズ（@Phase メタデータ）の操作。 */
export const PHASEOPS = {
  set(n: ModelNode, value: string): void {
    const M = S.M, e = n.entry;
    if (e.phaseVal && e.phaseBlock) {
      if (!value) {
        const r = removeRange(S.text, e.phaseBlock.start, e.phaseBlock.end ?? e.phaseBlock.start);
        setText(r.text, { changeAt: r.at, flash: [r.at, r.at + 1] });
        toast(`${n.name} のフェーズ指定を外しました`);
        return;
      }
      const tok = `${M.phaseEnum}::${value}`;
      setText(S.text.slice(0, e.phaseVal.start) + tok + S.text.slice(e.phaseVal.end), { changeAt: e.phaseVal.start, flash: [e.phaseVal.start, e.phaseVal.start + tok.length] });
    } else {
      if (!value) {
        toast("パッケージから継承しているため、ここでは外せません");
        renderInspector();
        return;
      }
      const inh = M.phaseOf(e);
      if (inh && inh.value === value) {
        toast("すでにパッケージから継承しています");
        return;
      }
      const r = insertInto(S.text, e, `@Phase { stage = ${M.phaseEnum}::${value}; }`);
      setText(r.text, { changeAt: r.at, flash: [r.at, r.at + r.len] });
    }
    toast(`${n.name} を「${phaseLabel(value)}」にしました`);
  },

  /** フェーズの定義（metadata def と enum def）を最初の package に足す。package が無ければ、作るよう案内する。 */
  async init(): Promise<void> {
    let text = S.text;
    let pkg = firstPackage();
    if (!pkg) {
      const name = await askPackageName();
      if (!name) return;
      ({ text, pkg } = appendPackage(S.text, name));
    }
    if (pkg.open == null) {
      toast("このファイルの書き方では、フェーズを足せません（最初の package が { } で囲まれていません）");
      return;
    }
    const i1 = indentAt(text, pkg.start) + "    ";
    const ins =
      `\n${i1}// フェーズ管理：要素やパッケージに @Phase を付けて分類する（パッケージに付けると中の要素が継承）\n` +
      `${i1}metadata def Phase { attribute stage : PhaseKind; }\n` +
      `${i1}enum def PhaseKind { enum StakeholderNeeds; enum SystemRequirements; enum Architecture; enum Verification; }\n`;
    const at = pkg.open + 1;
    setText(text.slice(0, at) + ins + text.slice(at), { changeAt: at, flash: [at, at + ins.length] });
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

export function deleteSel(): void {
  const ns = selNodes();
  const only = ns[0];
  if (!only) return;
  if (ns.length === 1) {
    OPS.deleteNode(only);
    return;
  }
  const r = perform({ op: "delete", keys: ns.map((n) => n.key), ctx: ctxKey() });
  if (!r) return;
  for (const n of ns) for (const v of Object.values(S.layout)) delete v.pos[n.key];
  clearSel();
  setText(r.text, { changeAt: r.at, flash: r.flash });
  commitLayout();
  toast(`${ns.length} 個の定義をテキストから削除しました`);
}

/** 選んだ定義のフェーズをまとめて設定する。 */
export function setPhaseSel(value: string): void {
  const ns = selNodes().filter((n) => n.isDef);
  const only = ns[0];
  if (!only || !S.M.phases) return;
  if (ns.length === 1) {
    PHASEOPS.set(only, value);
    return;
  }
  const edits: Edit[] = ns.map((n) =>
    n.entry.phaseVal
      ? { at: n.entry.phaseVal.start, del: n.entry.phaseVal.end - n.entry.phaseVal.start, ins: `${S.M.phaseEnum}::${value}` }
      : insertEdit(S.text, n.entry, `@Phase { stage = ${S.M.phaseEnum}::${value}; }`),
  );
  const at = Math.min(...edits.map((e) => e.at));
  setText(applyEdits(S.text, edits), { changeAt: at, flash: [at, at + 1] });
  toast(`${ns.length} 個を「${phaseLabel(value)}」にしました`);
}
