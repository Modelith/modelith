// 接続点とポートの操作。接続点は配置情報、ポートはテキストの宣言として持つ。

import type { ModelNode, Port, PortDir } from "../core";
import { perform } from "./intent";
import { pinsOf, type Pin } from "./geometry";
import type { Ends, ViewLayout } from "./layout";
import { S, type EndSpec } from "./state";
import { commitLayout, setText, toast } from "./sync";
import { CC, curLayout, nodeByKey } from "./views";

export const DIR_LABEL: Record<PortDir, string> = { in: "入力", out: "出力", inout: "双方向" };

/**
 * すべてのビューの配置にある、線の端（`@ends`）の 1 つずつについて処理を呼ぶ。
 *
 * @param fn 処理。そのビューの配置・線の ID・両端の接続点 ID を受け取る（val を書き換えると配置も変わる）
 */
const forEachEnds = (fn: (v: ViewLayout, key: string, val: Ends) => void): void => {
  for (const v of Object.values(S.layout)) for (const [k, val] of Object.entries(v.ends)) fn(v, k, val);
};
/**
 * 線の ID（`種類|元のキー|先のキー|…`）から、種類と両端の要素のキーを取り出す。
 *
 * @param edgeId 線の ID（`flow|A|B|#1` など）
 * @returns `[種類, 元のキー, 先のキー]`。足りない部分は空文字列
 * @example
 * endNodes("flow|A|B|#1") // → ["flow", "A", "B"]
 * endNodes("x")           // → ["x", "", ""]（区切りが無い）
 */
const endNodes = (edgeId: string): [string, string, string] => {
  const [kind = "", f = "", t = ""] = edgeId.split("|");
  return [kind, f, t];
};

/**
 * 存在しない要素・線・ポートを指す接続点と線の端を、すべてのビューの配置（S.layout）から消す。
 * どの線の端にも使われていない自由な接続点も消す（選択中の接続点は残す）。内部ブロック図（`ibd:`）のビューでは線の端と要素は消さない。
 */
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

/**
 * 要素に新しく作る自由な接続点の ID を決める。すべてのビューで、その要素にまだ使われていない `a1`・`a2`… の最小のもの。
 *
 * @param nk 要素のキー
 * @returns 接続点の ID
 * @example
 * // どのビューにも A の接続点が無いとき
 * newAnchorId("A") // → "a1"
 * // A に a1・a3 があるとき
 * newAnchorId("A") // → "a2"（空いている最小の番号）
 */
function newAnchorId(nk: string): string {
  const all = new Set<string>();
  for (const v of Object.values(S.layout)) for (const x of Object.keys(v.pins[nk] ?? {})) all.add(x);
  let k = 1;
  while (all.has("a" + k)) k++;
  return "a" + k;
}

/**
 * 描いた線の両端を、表示中のビューの配置に接続点として記録する。端が既存の接続点でなければ、その縁の位置に新しい接続点を作る。
 *
 * @param edgeId 記録する線の ID（`flow|A|B|#1` など）
 * @param wire 描いた線の両端（元の縁の位置と、先の縁の位置。先が決まっていなければ null で、その端は未指定になる）
 */
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

/** 接続点とポートの操作（インスペクタ・右クリックメニューから呼ぶ）。 */
export const PINOPS = {
  /**
   * 接続点をポートにする。コアに意図 `makePort` を渡してテキストにポートを書き、その接続点につながる flow は「部品.ポート」に書き換える（setText）。
   * すべてのビューで接続点の ID を `port:名前` に付け替え、作ったポートを選んで配置を確定し、トーストで知らせる。コアが断ったときは何も変えない。
   *
   * @param n 接続点を持つ要素
   * @param pin ポートにする接続点（自由な接続点 `a1` など）
   * @param name ポートの名前（SysML v2 の基本名）
   * @param dir ポートの向き（`in`・`out`・`inout`）
   * @param type ポートの型の名前（空文字列なら型を書かない）
   */
  async makePort(n: ModelNode, pin: Pin, name: string, dir: PortDir, type: string): Promise<void> {
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
    const r = await perform({ op: "makePort", key: n.key, name, dir, type, flows: [...flows.values()], ctx: CC().ctx?.key });
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

  /**
   * ポートの向き（in / out / inout）を書き換える。コアに意図 `setPortDir` を渡してテキストを書き換え（setText）、トーストで知らせる。
   * コアが断ったときは何も変えない。
   *
   * @param n ポートを持つ要素
   * @param port 向きを変えるポート
   * @param dir 新しい向き（`in`・`out`・`inout`）
   */
  async setDir(n: ModelNode, port: Port, dir: PortDir): Promise<void> {
    const r = await perform({ op: "setPortDir", key: n.key, port: port.name, dir, ctx: CC().ctx?.key });
    if (!r) return;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    toast(`ポート「${port.name}」を${DIR_LABEL[dir]}にしました`);
  },

  /**
   * ポートを削除する。コアに意図 `deletePort` を渡してテキストからポートの宣言を消し（setText）、すべてのビューからその接続点を消して
   * 選択を外し、配置を確定してトーストで知らせる。接続点がポートでない・コアが断ったときは何もしない。
   *
   * @param n ポートを持つ要素
   * @param pin 消すポートの接続点（`port:名前`）
   */
  async deletePort(n: ModelNode, pin: Pin): Promise<void> {
    const port = pin.port;
    if (!port) return;
    const r = await perform({ op: "deletePort", key: n.key, port: port.name, ctx: CC().ctx?.key });
    if (!r) return;
    for (const v of Object.values(S.layout)) delete v.pins[n.key]?.[pin.id];
    S.selPin = null;
    setText(r.text, { changeAt: r.at, flash: r.flash });
    commitLayout();
    toast(`ポート「${port.name}」を削除しました`);
  },

  /**
   * 自由な接続点を外す（配置だけの操作で、テキストは変えない）。すべてのビューからその接続点を消し、それを指す線の端を未指定に戻す
   * （両端とも未指定になった線の端は消す）。選択を外して配置を確定し、トーストで知らせる。線は自動の位置に戻る。
   *
   * @param n 接続点を持つ要素
   * @param pinId 外す接続点の ID（`a1` など）
   */
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

/**
 * 選択中の接続点（S.selPin）と、その要素を、表示中のビューから探す。
 *
 * @returns 要素と接続点。何も選んでいない・要素や接続点が見つからなければ null
 * @example
 * // A の接続点 a1 を選んでいるとき
 * selPinInfo() // → { n: A, pin: { id: "a1", side: "t", t: 0.3 } }
 * // 接続点を選んでいないとき
 * selPinInfo() // → null
 */
export function selPinInfo(): { n: ModelNode; pin: Pin } | null {
  if (!S.selPin) return null;
  const sp = S.selPin;
  const n = nodeByKey(sp.node);
  if (!n) return null;
  const pin = pinsFor(n).find((p) => p.id === sp.pin);
  return pin ? { n, pin } : null;
}

/**
 * 表示中のビューでの、要素の接続点を集める（geometry の pinsOf を、今の配置とビューで呼ぶ）。
 *
 * @param n 図の要素
 * @returns ポート由来（in・out・inout の順）と自由な接続点の一覧。無ければ空の配列
 * @example
 * // 表示中のビュー（trace）の配置で、A に自由な接続点 a1 が ["t", 0.3] にあるとき
 * pinsFor(A) // → [{ id: "a1", side: "t", t: 0.3 }]
 * // 接続点もポートも無いとき
 * pinsFor(B) // → []
 */
export const pinsFor = (n: ModelNode): Pin[] => pinsOf(n, curLayout(), S.view);
