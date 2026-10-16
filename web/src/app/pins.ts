// 接続点とポートの操作。接続点は配置情報、ポートはテキストの宣言として持つ。

import type { ModelNode, Port, PortDir } from "../core";
import { perform } from "./intent";
import { pinsOf, type Pin } from "./geometry";
import type { Ends, ViewLayout } from "./layout";
import { S, type EndSpec } from "./state";
import { commitLayout, setText, toast } from "./sync";
import { CC, curLayout, nodeByKey } from "./views";

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

export const PINOPS = {
  /** 接続点をポートにする。その接続点につながる flow は「部品.ポート」に書き換える。 */
  makePort(n: ModelNode, pin: Pin, name: string, dir: PortDir, type: string): void {
    // この接続点につながる線（「部品.ポート」に書き換える端）
    const flows = new Map<string, { id: string; from?: boolean; to?: boolean }>();
    forEachEnds((_v, k, val) => {
      const [kind, f, t] = endNodes(k);
      if (kind !== "flow") return;
      const fe = flows.get(k) ?? { id: k };
      if (f === n.key && val[0] === pin.id) fe.from = true;
      if (t === n.key && val[1] === pin.id) fe.to = true;
      if (fe.from || fe.to) flows.set(k, fe);
    });
    const r = perform({ op: "makePort", key: n.key, name, dir, type, flows: [...flows.values()], ctx: CC().ctx?.key });
    if (!r) return;
    const newId = "port:" + name;
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
    S.selPin = { node: n.key, pin: newId };
    S.portForm = false;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(`${n.name} にポート「${name}」を追加しました` + (flows.size ? "（つながっていた線を、このポートにつなぎ直しました）" : ""));
  },

  /** ポートの向き（in / out / inout）を書き換える。 */
  setDir(n: ModelNode, port: Port, dir: PortDir): void {
    const r = perform({ op: "setPortDir", key: n.key, port: port.name, dir, ctx: CC().ctx?.key });
    if (!r) return;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast(`ポート「${port.name}」を${DIR_LABEL[dir]}にしました`);
  },

  deletePort(n: ModelNode, pin: Pin): void {
    const port = pin.port;
    if (!port) return;
    const r = perform({ op: "deletePort", key: n.key, port: port.name, ctx: CC().ctx?.key });
    if (!r) return;
    for (const v of Object.values(S.layout)) delete v.pins[n.key]?.[pin.id];
    S.selPin = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(`ポート「${port.name}」を削除しました`);
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
