// 接続点とポートの操作。接続点は配置情報、ポートはテキストの宣言として持つ。

import { applyEdits, insertEdit, removeRange, type ModelNode, type Port, type PortDir } from "../core";
import type { Edit } from "../core";
import { pinsOf, type Pin } from "./geometry";
import type { Ends, ViewLayout } from "./layout";
import { S, type EndSpec } from "./state";
import { commitLayout, setText, toast, withLayout } from "./sync";
import { curLayout, edgeById, nodeByKey } from "./views";

export const DIR_LABEL: Record<PortDir, string> = { in: "入力", out: "出力", inout: "双方向" };

const forEachEnds = (fn: (v: ViewLayout, key: string, val: Ends) => void): void => {
  for (const v of Object.values(S.layout)) for (const [k, val] of Object.entries(v.ends)) fn(v, k, val);
};
const endNodes = (edgeId: string): [string, string, string] => {
  const [kind = "", f = "", t = ""] = edgeId.split("|");
  return [kind, f, t];
};

/** 存在しない要素・線・ポートを指す接続点と線の端を消す。 */
export function prunePins(): void {
  const ids = new Set(S.M.edges.map((e) => e.id));
  for (const [vk, v] of Object.entries(S.layout)) {
    const isIbd = vk.startsWith("ibd:");
    if (!isIbd) for (const k of Object.keys(v.ends)) if (!ids.has(k)) delete v.ends[k];
    for (const [nk, pv] of Object.entries(v.pins)) {
      const n = isIbd ? null : nodeByKey(nk);
      if (!isIbd && !n) {
        delete v.pins[nk];
        continue;
      }
      for (const id of Object.keys(pv)) {
        if (id.startsWith("port:")) {
          if (n && !n.ports.some((p) => "port:" + p.name === id)) delete pv[id];
          continue;
        }
        const used = Object.entries(v.ends).some(([k, val]) => {
          const [, f, t] = endNodes(k);
          return (f === nk && val[0] === id) || (t === nk && val[1] === id);
        });
        if (!used && !(S.selPin && S.selPin.node === nk && S.selPin.pin === id)) delete pv[id];
      }
    }
  }
}

function newAnchorId(nk: string): string {
  const all = new Set<string>();
  for (const v of Object.values(S.layout)) for (const x of Object.keys(v.pins[nk] ?? {})) all.add(x);
  let k = 1;
  while (all.has("a" + k)) k++;
  return "a" + k;
}

/** 描いた線の両端を、接続点（無ければ新しく作る）として配置に記録する。 */
export function attachEnds(edgeId: string, wire: { from: EndSpec; to: EndSpec | null }): void {
  const L = curLayout();
  const endId = (spec: EndSpec | null): string | null => {
    if (!spec) return null;
    if (spec.pin) return spec.pin;
    const id = newAnchorId(spec.node);
    (L.pins[spec.node] ||= {})[id] = [spec.side, spec.t];
    return id;
  };
  L.ends[edgeId] = [endId(wire.from), endId(wire.to)];
}

const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const PINOPS = {
  /** 接続点をポートにする。その接続点につながる flow は「部品.ポート」に書き換える。 */
  makePort(n: ModelNode, pin: Pin, name: string, dir: PortDir, type: string): void {
    if (!/^[A-Za-z_]\w*$/.test(name)) {
      toast("ポート名は英字・数字・_ で入力してください");
      return;
    }
    const host = n.portHost ?? n.entry;
    if (host.children.some((c) => c.name === name)) {
      toast(`「${name}」は ${host.name} の中で既に使われています`);
      return;
    }
    const newId = "port:" + name;
    const decl = `${dir} port ${name}${type ? " : " + type : ""};`;
    const portEdit = insertEdit(S.text, host, decl);
    const edits: Edit[] = [portEdit];
    let upgraded = 0;
    forEachEnds((_v, k, val) => {
      const [kind, f, t] = endNodes(k);
      if (kind !== "flow") return;
      const ed = edgeById(k);
      const r = ed?.rel;
      if (!ed || !r || (r.rel !== "flow" && r.rel !== "connect")) return;
      const st = ed.src.start, en = ed.src.end;
      const stmt = S.text.slice(st, en);
      let out = stmt;
      if (f === n.key && val[0] === pin.id) out = out.replace(new RegExp(`(\\b(?:from|connect)\\s+)${reEsc(r.a)}(?![\\w.])`), `$1${r.a.split(".")[0] ?? ""}.${name}`);
      if (t === n.key && val[1] === pin.id) out = out.replace(new RegExp(`(\\bto\\s+)${reEsc(r.b)}(?![\\w.])`), `$1${r.b.split(".")[0] ?? ""}.${name}`);
      if (out !== stmt && !edits.some((e) => e.at === st)) {
        edits.push({ at: st, del: en - st, ins: out });
        upgraded++;
      }
    });
    for (const v of Object.values(S.layout)) {
      const pv = v.pins[n.key];
      const p = pv?.[pin.id];
      if (pv && p) {
        pv[newId] = p;
        delete pv[pin.id];
      }
    }
    (curLayout().pins[n.key] ||= {})[newId] = [pin.side, pin.t];
    forEachEnds((_v, k, val) => {
      const [, f, t] = endNodes(k);
      if (f === n.key && val[0] === pin.id) val[0] = newId;
      if (t === n.key && val[1] === pin.id) val[1] = newId;
    });
    const first = edits.reduce((a, e) => Math.min(a, e.at), Infinity);
    const t = applyEdits(S.text, edits);
    const at = t.indexOf(`port ${name}`, Math.max(0, first - 5));
    S.selPin = { node: n.key, pin: newId };
    S.portForm = false;
    setText(withLayout(t), { changeAt: first, flash: at >= 0 ? [at, at + portEdit.ins.length] : null });
    toast(`${n.name} にポート「${name}」を追加しました` + (upgraded ? `（flow ${upgraded} 件をポート接続に更新）` : ""));
  },

  /** ポートの向き（in / out / inout）を書き換える。 */
  setDir(port: Port, dir: PortDir): void {
    const e = port.entry;
    const head = S.text.slice(e.start, e.headEnd);
    const nh = head.replace(/^((?:(?:private|public|protected)\s+)?)(?:(?:in|out|inout)\s+)?/, `$1${dir} `);
    setText(S.text.slice(0, e.start) + nh + S.text.slice(e.headEnd), { changeAt: e.start, flash: [e.start, e.start + nh.length] });
    toast(`ポート「${port.name}」を${DIR_LABEL[dir]}にしました`);
  },

  deletePort(n: ModelNode, pin: Pin): void {
    const port = pin.port;
    if (!port) return;
    const r = removeRange(S.text, port.entry.start, port.entry.end);
    for (const v of Object.values(S.layout)) delete v.pins[n.key]?.[pin.id];
    S.selPin = null;
    setText(withLayout(r.text), { changeAt: r.at, flash: [r.at, r.at + 1] });
    toast(`ポート「${port.name}」をテキストから削除しました`);
  },

  /** 接続点を外す（線は自動の位置に戻る）。 */
  removeAnchor(n: ModelNode, pinId: string): void {
    for (const v of Object.values(S.layout)) delete v.pins[n.key]?.[pinId];
    forEachEnds((v, k, val) => {
      const [, f, t] = endNodes(k);
      if (f === n.key && val[0] === pinId) val[0] = null;
      if (t === n.key && val[1] === pinId) val[1] = null;
      if (!val[0] && !val[1]) delete v.ends[k];
    });
    S.selPin = null;
    commitLayout();
    toast("接続点を外しました（線は自動の位置に戻ります）");
  },
};

/** 選択中の接続点。 */
export function selPinInfo(): { n: ModelNode; pin: Pin } | null {
  if (!S.selPin) return null;
  const sp = S.selPin;
  const n = nodeByKey(sp.node);
  if (!n) return null;
  const pin = pinsFor(n).find((p) => p.id === sp.pin);
  return pin ? { n, pin } : null;
}

/** 現在のビューでの要素の接続点。 */
export const pinsFor = (n: ModelNode): Pin[] => pinsOf(n, curLayout(), S.view);
