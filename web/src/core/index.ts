// 暫定コアの公開インタフェース（ADR-0009）。UI はこのモジュールだけを通してコアを使う。
// Rust コア（Worker 内 wasm、ADR-0003）に差し替えるときは、この境界を保ったまま実装を入れ替える。
export { parse, mask, LAYOUT_RE } from "./parser";
export { build, family, isLib } from "./model";
export { applyEdits, diffRange, indentAt, insertEdit, insertInto, lineOf, lineStart, removeRange, writeLayout } from "./text-ops";
export type { Edit, InsertTarget } from "./text-ops";
export type * from "./types";
