// 暫定コアの公開インタフェース（ADR-0009）。UI はこのモジュールだけを通してコアを使う。
// Rust コア（wasm、ADR-0003・ADR-0015）に差し替えるときは、この境界を保ったまま実装を入れ替える。
export { isReservedWord, mask, LAYOUT_RE } from "./parser";
// 解析とモデル構築は Rust のコア（wasm）で行う。暫定の TS コアは、比べるテストのために beta.1 まで残す（ADR-0015・ADR-0016）
export { build, edit, initCore, parse } from "./rust";
export type {
  CreatedProjectFile, DescribedPlugin, EditResult, Intent, PluginChange, PluginFiles, PluginInfo, PluginLoadProblem, PluginRuntime, PluginsResult, PluginSummary, PluginUse,
  ProjectFile, ProjectFileResult, ProjectProblem, Refused, RuleFinding, RuleSeverity, TextEdit,
} from "./rust";
export { CoreClient, STALE_EDIT, startCore } from "./client";
export { readLayout } from "./parser";
export { family, isLib } from "./model";
export { stdViewLabel } from "./views";
export { applyEdits, applyTextEdits, diffRange, indentAt, insertEdit, insertInto, lineOf, lineStart, removeLayoutComment, removeRange } from "./text-ops";
export type { Edit, InsertTarget } from "./text-ops";
export type * from "./types";
