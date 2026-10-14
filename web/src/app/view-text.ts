// 画面で作る図（標準の view）のテキストを組み立てる純粋関数（ADR-0005、F-VIEW-8）。

import { isReservedWord, type Entry, type Expose, type ViewKind } from "../core";

/** SysML の名前として書く（基本名に使えない文字や予約語を含むときは引用名、8.2.2.1）。 */
export const sysmlName = (name: string): string =>
  /^[A-Za-z_]\w*$/.test(name) && !isReservedWord(name) ? name : `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** 名前を持つ親をたどった名前の並び（package P の中の A なら ["P", "A"]）。 */
function namePath(e: Entry): string[] {
  const names: string[] = [];
  for (let a: Entry | null = e; a; a = a.pe) names.unshift(a.name);
  return names;
}

/** テキストに書く修飾名（P::A。名前は必要なら引用名にする）。 */
export const qualifiedName = (e: Entry): string => namePath(e).map(sysmlName).join("::");

/** expose の対象と比べるための修飾名（引用符を外した形。パーサが読む Expose.target と同じ形）。 */
export const plainQualifiedName = (e: Entry): string => namePath(e).join("::");

/** 描き方に対応する標準ビュー定義（9.2.20）。 */
export const STD_VIEW_FOR: Record<ViewKind, string> = {
  general: "GeneralView",
  interconnection: "InterconnectionView",
  stateTransition: "StateTransitionView",
  sequence: "SequenceView",
};

/**
 * 図を保存するときの view の宣言。要素は 1 つずつ expose する。
 * indent は view を置く位置の字下げ。
 */
export function viewDeclaration(name: string, kind: ViewKind, targets: readonly Entry[], indent: string): string {
  const lines = targets.map((t) => `${indent}    expose ${qualifiedName(t)};`);
  return `view ${sysmlName(name)} : ${STD_VIEW_FOR[kind]} {\n${lines.join("\n")}${lines.length ? "\n" : ""}${indent}}`;
}

/** e だけを出している expose（中身をまとめて出す expose は含めない）。図から外すときに消す行。 */
export const exposesOnlyFor = (view: Entry, e: Entry): Expose[] =>
  (view.exposes ?? []).filter((x) => !x.members && !x.recursive && !x.filter && x.target === plainQualifiedName(e));
