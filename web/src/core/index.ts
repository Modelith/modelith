// 暫定コアの公開インタフェース（ADR-0009）。UI はこのモジュールだけを通してコアを使う。
// Rust コア（wasm、ADR-0003・ADR-0015）に差し替えるときは、この境界を保ったまま実装を入れ替える。
export { isReservedWord, mask, LAYOUT_RE } from "./parser";
// 解析は Rust のパーサ（wasm）で行う。暫定の TS パーサは、比べるテストのために残す（ADR-0015）
export { initCore, parse } from "./rust";
export { build, family, isLib } from "./model";
export { stdViewLabel } from "./views";
export { applyEdits, diffRange, indentAt, insertEdit, insertInto, lineOf, lineStart, removeLayoutComment, removeRange } from "./text-ops";
export type { Edit, InsertTarget } from "./text-ops";
export type * from "./types";
