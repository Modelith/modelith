// 図からの編集操作。すべてテキストの書き換えとして行い、setText で反映する（ADR-0001）。

import { applyEdits, indentAt, insertEdit, insertInto, mask, removeRange, type Edit, type Entry, type ModelEdge, type ModelNode } from "../core";
import { ask } from "./dialog";
import { shownDocName } from "./files";
import { nodeH, W } from "./geometry";
import { renderInspector, startRename } from "./inspector";
import { attachEnds } from "./pins";
import { commonParent, KW_FOR, type RelKind } from "./relations";
import { highlight, render } from "./render";
import { cancelConnect, clearSel, S } from "./state";
import { commitLayout, setText, toast } from "./sync";
import { CC, curLayout, nodeByKey, phaseLabel } from "./views";
import type { Pos } from "./layout";
import { appendPackage, isPackageName, packageNameFor } from "./new-package";

const NAME_RE = /^[A-Za-z_]\w*$/;
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const uniqueName = (base: string): string => {
  let n = base, k = 2;
  while (S.M.byName.has(n)) n = base + k++;
  return n;
};
export const uniqueChild = (entry: Entry, base: string): string => {
  let n = base, k = 2;
  while (entry.children.some((c) => c.name === n)) n = base + k++;
  return n;
};
const firstPackage = (): Entry | undefined => S.P.entries.find((e) => e.kind === "package");

/** 種類 kind の要素を追加する package（同じ種類の要素が最後に置かれた package）。 */
function pkgFor(kind: string): Entry | undefined {
  const hit = [...S.P.entries].reverse().find((e) => e.kind === kind && e.pe && e.pe.kind === "package");
  return hit?.pe ?? firstPackage();
}

/**
 * package の無いファイルで要素を置こうとしたとき、断らずに新しい package を作るよう案内する（F-EDIT-7）。
 * 作れば、package を足したテキストとその package を返す（やめたら null）。
 */
async function offerNewPackage(): Promise<{ text: string; pkg: Entry } | null> {
  const r = await ask(
    "package を作りましょう",
    "SysML v2 では、要素を package（入れ物）の中に置きます。このファイルにはまだ package が無いので、新しく作ってそこに置きます。",
    [
      { id: "cancel", label: "やめる" },
      { id: "ok", label: "作って置く", kind: "primary" },
    ],
    { value: packageNameFor(shownDocName()), label: "package の名前" },
  );
  if (r?.id !== "ok") return null;
  const name = r.value.trim();
  if (!isPackageName(name)) {
    toast("package の名前は、英字か _ で始まる英数字にしてください");
    return null;
  }
  return appendPackage(S.text, name);
}

const NEW_NAME: Record<string, string> = {
  "part def": "NewPart", "requirement def": "NewRequirement", "constraint def": "NewConstraint", "concern def": "NewConcern",
  "verification def": "NewVerification", "analysis def": "NewAnalysis", "state def": "NewStates", "action def": "NewAction",
  "attribute def": "NewParams", "occurrence def": "NewScenario",
};

export const OPS = {
  /** 定義を追加し、図の pos に置く。package が無ければ、作るよう案内する。 */
  async addNode(kind: string, pos: Pos): Promise<void> {
    let text = S.text;
    let pkg = pkgFor(kind);
    if (!pkg) {
      const np = await offerNewPackage();
      if (!np) return;
      ({ text, pkg } = np);
    }
    const name = uniqueName(NEW_NAME[kind] ?? "NewElement");
    const lines: string[] = [];
    const inh = S.M.phases ? S.M.phaseOf(pkg) : null;
    if (S.phase && S.M.phases && (!inh || inh.value !== S.phase)) lines.push(`@Phase { stage = ${S.M.phaseEnum}::${S.phase}; }`);
    if (kind === "requirement def") lines.push("doc /* ここに要求文を書く */");
    if (kind === "constraint def") lines.push("in x : Real; in y : Real;", "y == x");
    if (kind === "occurrence def") lines.push("doc /* シナリオの説明 */");
    const i1 = indentAt(text, pkg.start) + "    ", i2 = i1 + "    ";
    const r = insertInto(text, pkg, `${kind} ${name} {` + lines.map((l) => "\n" + i2 + l).join("") + "\n" + i1 + "}");
    if (kind === "occurrence def" && S.view === "seq") {
      S.seqCtx = name;
      setText(r.text, { changeAt: r.at, flash: [r.at, r.at + r.len] });
      toast(`シナリオ「${name}」を追加しました。ライフラインを追加してください`);
      return;
    }
    curLayout().pos[name] = pos;
    S.sel = name;
    setText(r.text, { changeAt: r.at, flash: [r.at, r.at + r.len] });
    commitLayout();
    toast(`「${kind} ${name}」をテキストに追加しました`);
    startRename();
  },

  /** 内部ブロック図の部品・シーケンス図のライフラインを追加する。 */
  addUsage(type: string, pos: Pos): void {
    const c = CC();
    if (!c.ctx) {
      toast("追加先がありません");
      return;
    }
    const nm = uniqueChild(c.ctx.entry, lowerFirst(type));
    const r = insertInto(S.text, c.ctx.entry, `part ${nm} : ${type};`);
    if (S.view === "ibd") curLayout().pos["u:" + nm] = pos;
    clearSel();
    S.sel = (S.view === "ibd" ? "u:" : "l:") + nm;
    setText(r.text, { changeAt: r.at, flash: [r.at, r.at + r.len] });
    if (S.view === "ibd") commitLayout();
    toast(`${c.ctx.name} に「part ${nm} : ${type}」を追加しました`);
  },

  /** 名前を変え、参照と配置情報もまとめて書き換える。 */
  rename(n: ModelNode, nn: string): boolean {
    if (!NAME_RE.test(nn)) {
      toast("名前は英字・数字・_ で入力してください");
      return false;
    }
    if (nn === n.name) return true;
    if (S.M.byName.has(nn)) {
      toast(`「${nn}」は既に使われています`);
      return false;
    }
    const { m } = mask(S.text);
    const t = S.text;
    const re = n.isDef ? new RegExp(`(?<![\\w])${n.name}(?![\\w])`, "g") : new RegExp(`(?<![\\w.])${n.name}(?=\\.|\\s*[:;{])`, "g");
    const hits: number[] = [];
    let x: RegExpExecArray | null;
    while ((x = re.exec(m))) hits.push(x.index);
    if (!n.isDef) {
      const e = n.entry;
      const hm = t.slice(e.start, e.headEnd).indexOf(n.name);
      const p = e.start + hm;
      if (hm >= 0 && !hits.includes(p)) hits.push(p);
    }
    hits.sort((a, b) => b - a);
    let out = t;
    for (const p of hits) out = out.slice(0, p) + nn + out.slice(p + n.name.length);
    for (const v of Object.values(S.layout)) {
      const pos = v.pos[n.key];
      if (pos) {
        v.pos[nn] = pos;
        delete v.pos[n.key];
      }
      const pv = v.pins[n.key];
      if (pv) {
        v.pins[nn] = pv;
        delete v.pins[n.key];
      }
      for (const [k, val] of Object.entries(v.ends)) {
        const parts = k.split("|");
        if (parts[1] === n.key || parts[2] === n.key) {
          v.ends[parts.map((s, i) => ((i === 1 || i === 2) && s === n.key ? nn : s)).join("|")] = val;
          delete v.ends[k];
        }
      }
    }
    S.sel = nn;
    const first = Math.min(...hits);
    setText(out, { changeAt: first, flash: [n.entry.start, n.entry.headEnd + (nn.length - n.name.length)] });
    commitLayout();
    toast(`${hits.length} か所の「${n.name}」を「${nn}」に変更しました`);
    return true;
  },

  deleteNode(n: ModelNode): void {
    const r = removeRange(S.text, n.entry.start, n.entry.end);
    for (const v of Object.values(S.layout)) delete v.pos[n.key];
    S.sel = null;
    setText(r.text, { changeAt: r.at, flash: [r.at, r.at + 1] });
    commitLayout();
    toast(`「${n.name}」の定義をテキストから削除しました`);
  },

  deleteEdge(ed: ModelEdge): void {
    const r = removeRange(S.text, ed.src.start, ed.src.end);
    S.selEdge = null;
    setText(r.text, { changeAt: r.at, flash: [r.at, r.at + 1] });
    toast("関係をテキストから削除しました");
  },

  /** a から b への関係を追加する。線を描いて追加した場合は、その端の位置も記録する。 */
  connect(a: ModelNode, b: ModelNode, rel: RelKind): void {
    const wire = S.wire;
    const portOf = (sp: { pin: string | null } | null | undefined): string | null => (sp?.pin?.startsWith("port:") ? sp.pin.slice(5) : null);
    const pkg0 = firstPackage();
    let r: { text: string; at: number; len: number } | null = null;
    let what = "";
    if (rel === "comp") {
      const kw = KW_FOR[b.kind] ?? "part";
      const nm = uniqueChild(a.entry, lowerFirst(b.name));
      r = insertInto(S.text, a.entry, `${kw} ${nm} : ${b.name};`);
      what = `${a.name} に「${kw} ${nm} : ${b.name}」`;
    } else if (rel === "satisfy") {
      const host = [...S.P.rels].reverse().find((x) => x.rel === "satisfy")?.pe ?? pkg0;
      if (host) r = insertInto(S.text, host, `satisfy ${b.name} by ${a.name};`);
      what = `「satisfy ${b.name} by ${a.name}」`;
    } else if (rel === "verify") {
      const obj = S.P.rels.find((x) => x.rel === "verify" && x.pe === a.entry);
      what = `${a.name} に「verify ${b.name}」`;
      if (obj && a.entry.open != null) {
        // 既存の objective があればそこへ
        const { m } = mask(S.text);
        const oi = m.indexOf("objective", a.entry.open);
        const ob = m.indexOf("{", oi);
        let d = 0, k = ob;
        for (; k < m.length; k++) {
          if (m[k] === "{") d++;
          else if (m[k] === "}") {
            d--;
            if (!d) break;
          }
        }
        r = insertInto(S.text, { start: oi, headEnd: k, close: k }, `verify ${b.name};`);
      } else r = insertInto(S.text, a.entry, `objective { verify ${b.name}; }`);
    } else if (rel === "frame") {
      r = insertInto(S.text, a.entry, `frame concern ${uniqueChild(a.entry, lowerFirst(b.name))} : ${b.name};`);
      what = `${a.name} に「frame concern」`;
    } else if (rel === "derive") {
      const host = [...S.P.rels].reverse().find((x) => x.rel === "derive")?.pe ?? a.entry.pe ?? pkg0;
      if (host) r = insertInto(S.text, host, `#derivation dependency from ${a.name} to ${b.name};`);
      what = `「${a.name} は ${b.name} から導出」`;
    } else {
      const ctx = CC().ctx;
      const P = a.usage && ctx ? { parent: ctx.entry, ua: a.entry, ub: b.entry } : commonParent(a, b);
      if (!P) return;
      const fp = wire ? portOf(wire.from) : null, tp = wire ? portOf(wire.to) : null;
      const A = P.ua.name + (fp ? "." + fp : ""), B = P.ub.name + (tp ? "." + tp : "");
      r = insertInto(S.text, P.parent, `flow from ${A} to ${B};`);
      what = `${P.parent.name} に「flow from ${A} to ${B}」`;
    }
    if (!r) return;
    const before = new Set([...S.M.edges, ...CC().edges].map((e) => e.id));
    cancelConnect();
    setText(r.text, { changeAt: r.at, flash: [r.at, r.at + r.len] });
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
      toast("名前は英字・数字・_ で入力してください");
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
      const np = await offerNewPackage();
      if (!np) return;
      ({ text, pkg } = np);
    }
    if (pkg.open == null) {
      toast("最初の package が { } で書かれていないため、フェーズの定義を足せません");
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
  const edits: Edit[] = ns.map((n) => ({ at: n.entry.start, del: n.entry.end - n.entry.start, ins: "" }));
  for (const n of ns) for (const v of Object.values(S.layout)) delete v.pos[n.key];
  const at = Math.min(...edits.map((e) => e.at));
  const text = applyEdits(S.text, edits).replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
  clearSel();
  setText(text, { changeAt: at, flash: [at, at + 1] });
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
