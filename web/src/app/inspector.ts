// 図の下に出るインスペクタ（選択中の要素・関係・接続点の情報と操作）。

import { lineOf, type ModelEdge, type ModelNode, type PortDir } from "../core";
import { $, closest, esc } from "./dom";
import type { Pin } from "./geometry";
import { centerOn, render, scrollEditorTo } from "./render";
import { OPS, MSGOPS, PHASEOPS, alignSel, deleteSel, selNodes, setPhaseSel, uniqueChild, type AlignMode } from "./ops";
import { openTab, renderTree, setTab } from "./panels";
import { DIR_LABEL, PINOPS, selPinInfo } from "./pins";
import { relOptions, type RelKind } from "./relations";
import { cancelConnect, clearSel, S } from "./state";
import { CC, curLayout, edgeById, nodeByKey, phaseLabel } from "./views";

const SELECT_STYLE = 'style="border:1px solid var(--rule);border-radius:6px;padding:6px;background:var(--panel2)"';
const DIRS: PortDir[] = ["in", "out", "inout"];
const delBtn = (act: string, label: string): string =>
  `<button data-act="${act}" class="${S.confirmDel ? "danger" : ""}">${S.confirmDel ? "もう一度押して削除" : label}</button>`;
const portName = (pin: string | null | undefined): string => (pin?.startsWith("port:") ? `.${pin.slice(5)}` : "");

/** インスペクタを描き直し、ツリーの選択とミニマップの位置も合わせる。 */
export function renderInspector(): void {
  const box = $("#insp");
  const html = inspectorHtml();
  box.hidden = html === null;
  if (html !== null) box.innerHTML = html;
  focusInput();
  renderTree();
  $("#mini").style.bottom = box.hidden ? "" : box.offsetHeight + 22 + "px";
}

/** 入力欄を出したときは、選択してフォーカスし Enter で確定できるようにする。 */
function focusInput(): void {
  const inp = document.querySelector<HTMLInputElement>("#insp input");
  if (!inp) return;
  setTimeout(() => {
    inp.focus();
    inp.select();
  }, 0);
  const okAct = inp.id === "renameIn" ? "renameOk" : inp.id === "msgName" ? "msgOk" : "portOk";
  inp.onkeydown = (ev) => {
    if (ev.key === "Enter") act(okAct);
    if (ev.key === "Escape" && inp.id === "renameIn") act("renameCancel");
  };
}

/** 表示する HTML（何も選んでいなければ null）。 */
function inspectorHtml(): string | null {
  if (S.mode === "connect") return connectHtml();
  if (S.selSet.size > 1) return multiHtml();
  const pi = selPinInfo();
  if (pi) return pinHtml(pi.n, pi.pin);
  if (S.sel) {
    const n = nodeByKey(S.sel);
    return n ? nodeHtml(n) : null;
  }
  if (S.selEdge) {
    const ed = edgeById(S.selEdge);
    return ed ? edgeHtml(ed) : null;
  }
  return null;
}

function connectHtml(): string | null {
  const a = nodeByKey(S.connectFrom);
  if (!a) return null;
  const fromTxt = portName(S.wire?.from.pin);
  const b = nodeByKey(S.connectTo);
  if (!b) {
    return `<div class="what"><small>${esc(a.name + fromTxt)} から線を引きます</small><b>接続先の要素をタップしてください</b></div><div class="acts"><button data-act="cancel">やめる</button></div>`;
  }
  const opts = relOptions(a, b);
  const toTxt = portName(S.wire?.to?.pin);
  return (
    `<div class="what"><small>追加する関係を選択</small><b>${esc(a.name + fromTxt)} → ${esc(b.name + toTxt)}</b></div><div class="acts">` +
    (opts.length
      ? opts.map((o) => `<button class="primary" data-rel="${o.rel}">${esc(o.label)}</button>`).join("")
      : `<span style="font-size:12px;color:var(--ink2)">この組み合わせで追加できる関係はありません</span>`) +
    `<button data-act="cancel">やめる</button></div>`
  );
}

function multiHtml(): string {
  const ns = selNodes();
  const phases = S.M.phases;
  return (
    `<div class="what"><small>${ns.length} 個を選択中（何もない所をドラッグで範囲選択、Shift＋クリックで増減）</small><b>${esc(ns.slice(0, 3).map((n) => n.name).join("、"))}${ns.length > 3 ? ` ほか${ns.length - 3}個` : ""}</b></div><div class="acts">` +
    `<button data-act="alLeft">左揃え</button><button data-act="alTop">上揃え</button><button data-act="alH">横に等間隔</button><button data-act="alV">縦に等間隔</button>` +
    (phases
      ? `<select id="phaseSelMulti" aria-label="フェーズをまとめて設定" ${SELECT_STYLE}><option value="">フェーズをまとめて設定…</option>${phases.map((p) => `<option value="${esc(p)}">${esc(phaseLabel(p))}</option>`).join("")}</select>`
      : "") +
    delBtn("delMulti", "まとめて削除") +
    `</div>`
  );
}

function pinHtml(n: ModelNode, pin: Pin): string {
  const p = pin.port;
  if (p) {
    return (
      `<div class="what"><small>ポート（${esc(n.name)}）・ドラッグで縁に沿って移動</small><b>${esc(p.name)}${p.type ? " : " + (p.conj ? "~" : "") + esc(p.type) : ""}</b></div><div class="acts">` +
      DIRS.map((d) => `<button data-dir="${d}" aria-pressed="${p.dir === d}" class="${p.dir === d ? "primary" : ""}">${DIR_LABEL[d]}</button>`).join("") +
      delBtn("delPort", "ポートを削除") +
      `</div>`
    );
  }
  if (S.portForm) {
    const pdefs = S.M.nodes.filter((x) => x.kind === "port def").map((x) => x.name);
    const guess: PortDir = pin.side === "r" ? "out" : pin.side === "l" ? "in" : "inout";
    if (S.portForm === true) S.portForm = { dir: guess };
    const f = S.portForm;
    return (
      `<div class="what"><small>ポートにする（${esc(n.name)} にポートを追加）</small></div>` +
      `<input id="portName" value="${esc(f.name || uniqueChild(n.portHost ?? n.entry, "p"))}" aria-label="ポート名">` +
      `<select id="portType" aria-label="ポートの型" ${SELECT_STYLE}><option value="">型なし</option>${pdefs.map((t) => `<option ${f.type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` +
      `<div class="acts">${DIRS.map((d) => `<button data-fdir="${d}" aria-pressed="${f.dir === d}" class="${f.dir === d ? "primary" : ""}">${DIR_LABEL[d]}</button>`).join("")}` +
      `<button class="primary" data-act="portOk">作成</button><button data-act="portCancel">やめる</button></div>`
    );
  }
  const used = Object.entries(curLayout().ends).filter(([k, v]) => {
    const [, f, t] = k.split("|");
    return (f === n.key && v[0] === pin.id) || (t === n.key && v[1] === pin.id);
  }).length;
  return (
    `<div class="what"><small>接続点（${esc(n.name)}）・線 ${used} 本・ドラッグで移動</small><b>ここからさらに線を引けます</b></div><div class="acts">` +
    `<button data-act="makePort" class="primary">ポートにする</button><button data-act="rmAnchor">接続点を外す</button></div>`
  );
}

function nodeHtml(n: ModelNode): string {
  if (S.renaming) {
    return `<div class="what"><small>新しい名前（参照もまとめて変更されます）</small></div><input id="renameIn" value="${esc(n.name)}" aria-label="新しい名前"><div class="acts"><button class="primary" data-act="renameOk">変更する</button><button data-act="renameCancel">やめる</button></div>`;
  }
  const e = n.entry;
  const line = lineOf(S.text, e.start);
  if (n.usage || n.lifeline) {
    return (
      `<div class="what"><small>«${esc(n.kind)}» テキスト ${line} 行目${n.usage ? "・縁の＋から線を引けます" : "・ライフラインから横にドラッグでメッセージを追加"}</small><b>${esc(n.name)}${e.type ? " : " + esc(e.type) : ""}</b></div><div class="acts">` +
      `<button data-act="goto">テキストで見る</button>` +
      (e.type && S.M.byName.has(e.type) ? `<button data-act="openType">型の定義へ</button>` : "") +
      delBtn("del", "削除") +
      `</div>`
    );
  }
  const phases = S.M.phases;
  const phSel =
    phases && n.isDef
      ? `<select id="phaseSel" aria-label="フェーズ" ${SELECT_STYLE}><option value="">フェーズなし</option>${phases.map((p) => `<option value="${esc(p)}" ${n.phase === p ? "selected" : ""}>${esc(phaseLabel(p))}${n.phase === p && !n.phaseOwn ? "（継承）" : ""}</option>`).join("")}</select>`
      : "";
  return (
    `<div class="what"><small>«${esc(n.kind)}» テキスト ${line} 行目・縁の＋から線を引けます</small><b>${esc(n.name)}</b></div>${phSel}<div class="acts">` +
    `<button data-act="goto">テキストで見る</button><button data-act="rename">名前を変更</button><button data-act="connect">関係を追加</button>` +
    delBtn("del", "削除") +
    `</div>`
  );
}

const EDGE_NAME: Record<string, string> = {
  comp: "部品・特性として持つ", satisfy: "要求を満たす «satisfy»", verify: "要求を検証する «verify»", frame: "関心事を扱う «frame»", flow: "流れ・接続", defined: "型（定義）", derive: "要求の導出 «derive»",
};

function edgeHtml(ed: ModelEdge): string {
  if (ed.kind === "message") {
    const c = CC();
    const i = ed.idx ?? 0;
    if (S.msgEdit) {
      const items = S.M.nodes.filter((x) => x.kind === "item def").map((x) => x.name);
      return (
        `<div class="what"><small>メッセージ ${i + 1} を編集</small></div><input id="msgName" value="${esc(ed.label || "")}" aria-label="メッセージ名">` +
        `<select id="msgType" aria-label="アイテムの型" ${SELECT_STYLE}><option value="">型なし</option>${items.map((it) => `<option ${ed.type === it ? "selected" : ""}>${esc(it)}</option>`).join("")}</select>` +
        `<div class="acts"><button class="primary" data-act="msgOk">保存</button><button data-act="msgCancel">やめる</button></div>`
      );
    }
    return (
      `<div class="what"><small>メッセージ ${i + 1}／${c.edges.length}：${esc(nodeByKey(ed.from)?.name ?? "?")} → ${esc(nodeByKey(ed.to)?.name ?? "?")}</small><b>${esc(ed.label || "（名前なし）")}${ed.type ? " : " + esc(ed.type) : ""}</b></div><div class="acts">` +
      `<button data-act="msgUp" ${i === 0 ? "disabled" : ""}>上へ</button><button data-act="msgDown" ${i === c.edges.length - 1 ? "disabled" : ""}>下へ</button>` +
      `<button data-act="msgEdit">名前・型を編集</button><button data-act="goto">テキストで見る</button>` +
      delBtn("delEdge", "削除") +
      `</div>`
    );
  }
  return (
    `<div class="what"><small>${esc(EDGE_NAME[ed.kind] ?? ed.kind)}${ed.label && ed.kind === "comp" ? "：" + esc(ed.label) : ""}</small><b>${esc(nodeByKey(ed.from)?.name ?? "?")} → ${esc(nodeByKey(ed.to)?.name ?? "?")}</b></div><div class="acts">` +
    `<button data-act="goto">テキストで見る</button>` +
    delBtn("delEdge", "関係を削除") +
    `</div>`
  );
}

export function startRename(): void {
  S.renaming = true;
  renderInspector();
}

const ALIGN_ACTS: Record<string, AlignMode> = { alLeft: "left", alTop: "top", alH: "hspace", alV: "vspace" };
const inputValue = (sel: string): string => document.querySelector<HTMLInputElement | HTMLSelectElement>(sel)?.value ?? "";

/** インスペクタ・右クリックメニューのボタンの操作。 */
export function act(a: string): void {
  const n = nodeByKey(S.sel);
  const mode = ALIGN_ACTS[a];
  if (mode) {
    alignSel(mode);
    return;
  }
  switch (a) {
    case "cancel":
      cancelConnect();
      render();
      renderInspector();
      return;
    case "rename":
      startRename();
      return;
    case "renameCancel":
      S.renaming = false;
      renderInspector();
      return;
    case "renameOk":
      if (n && OPS.rename(n, inputValue("#renameIn").trim())) {
        S.renaming = false;
        renderInspector();
      }
      return;
    case "connect":
      S.mode = "connect";
      S.connectFrom = S.sel;
      S.connectTo = null;
      S.wire = null;
      render();
      renderInspector();
      return;
    case "goto": {
      const ed = edgeById(S.selEdge);
      setTab("text");
      scrollEditorTo(n ? n.entry.start : ed ? ed.src.start : 0);
      return;
    }
    case "del":
    case "delEdge":
    case "delPort":
    case "delMulti":
      if (!S.confirmDel) {
        S.confirmDel = true;
        renderInspector();
        return;
      }
      S.confirmDel = false;
      deleteSelected(a, n);
      return;
    case "makePort":
      S.portForm = true;
      renderInspector();
      return;
    case "openType": {
      const tn = n && S.M.nodes.find((x) => x.isDef && x.name === n.entry.type);
      if (tn) {
        openTab("structure");
        clearSel();
        S.sel = tn.key;
        render();
        renderInspector();
        centerOn(tn.key);
      }
      return;
    }
    case "msgEdit":
    case "msgCancel":
      S.msgEdit = a === "msgEdit";
      renderInspector();
      return;
    case "msgOk": {
      const ed = edgeById(S.selEdge);
      if (ed && MSGOPS.update(ed, inputValue("#msgName").trim(), inputValue("#msgType"))) {
        S.msgEdit = false;
        renderInspector();
      }
      return;
    }
    case "msgUp":
    case "msgDown": {
      const ed = edgeById(S.selEdge);
      if (ed) MSGOPS.move(ed, a === "msgUp" ? -1 : 1);
      return;
    }
    case "portCancel":
      S.portForm = false;
      renderInspector();
      return;
    case "portOk": {
      const pi = selPinInfo();
      if (!pi) return;
      const dir = S.portForm && S.portForm !== true ? S.portForm.dir : "inout";
      PINOPS.makePort(pi.n, pi.pin, inputValue("#portName").trim(), dir, inputValue("#portType"));
      return;
    }
    case "rmAnchor": {
      const pi = selPinInfo();
      if (pi) PINOPS.removeAnchor(pi.n, pi.pin.id);
      return;
    }
  }
}

function deleteSelected(a: string, n: ModelNode | null): void {
  if (a === "del" && n) OPS.deleteNode(n);
  else if (a === "delEdge") {
    const ed = edgeById(S.selEdge);
    if (ed) OPS.deleteEdge(ed);
  } else if (a === "delPort") {
    const pi = selPinInfo();
    if (pi) PINOPS.deletePort(pi.n, pi.pin);
  } else if (a === "delMulti") deleteSel();
}

/** インスペクタのイベントを登録する。 */
export function initInspector(): void {
  const box = $("#insp");
  box.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLSelectElement)) return;
    if (t.id === "phaseSel") {
      const n = nodeByKey(S.sel);
      if (n) PHASEOPS.set(n, t.value);
    }
    if (t.id === "phaseSelMulti" && t.value) setPhaseSel(t.value);
  });
  box.addEventListener("click", (ev) => {
    const b = closest<HTMLButtonElement>(ev, "button");
    if (!b) return;
    const { rel, dir, fdir, act: a } = b.dataset;
    if (rel) {
      const from = nodeByKey(S.connectFrom), to = nodeByKey(S.connectTo);
      if (from && to) OPS.connect(from, to, rel as RelKind);
      return;
    }
    if (dir) {
      const pi = selPinInfo();
      if (pi?.pin.port) PINOPS.setDir(pi.n, pi.pin.port, dir as PortDir);
      return;
    }
    if (fdir) {
      S.portForm = { dir: fdir as PortDir, name: inputValue("#portName"), type: inputValue("#portType") };
      renderInspector();
      return;
    }
    if (a) act(a);
  });
}
