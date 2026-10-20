// コアの公開インタフェース。UI はこのモジュールだけを通してコアを使う。
// 解析・モデル構築・図の操作は Rust のコア（Worker 内の wasm）で行う（ADR-0003・ADR-0015・ADR-0016）。
export { build, edit, initCore, parse } from "./rust";
export type {
  CheckedPluginMessage, CreatedProjectFile, DescribedPlugin, PlacedDiagnostic, VersionedSnapshot, EditResult, Intent, PluginChange, PluginFiles, PluginInfo, PluginLoadProblem, PluginRuntime, PluginsResult, PluginSummary, PluginUse,
  ProjectFile, ProjectFileResult, ProjectProblem, Refused, RuleFinding, RuleSeverity, TextEdit,
} from "./rust";
export { CoreClient, STALE_EDIT, startCore } from "./client";
export { standardViewName, stdViewLabel } from "./views";
export { applyTextEdits, diffRange, lineOf, lineStart, readLayout, removeLayoutComment } from "./text";
export type * from "./types";
