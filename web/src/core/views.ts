// 標準ビュー定義の名前と、画面での名前（ADR-0014、F-VIEW-7）。
// view を描く要素と描き方に解決するのは Rust のコア（crates/modelith-core/src/model/views.rs、ADR-0016）。
// 仕様：9.2.20 標準ビュー定義（StandardViewDefinitions）。

/** 標準ビュー定義の名前と短い名前から、標準ビュー定義の名前への対応。 */
const STANDARD_VIEWS: Record<string, string> = {};
for (const [name, short] of [
  ["GeneralView", "gv"],
  ["InterconnectionView", "iv"],
  ["ActionFlowView", "afv"],
  ["StateTransitionView", "stv"],
  ["SequenceView", "sv"],
  ["GeometryView", "gev"],
  ["GridView", "grv"],
  ["BrowserView", "bv"],
] as const) {
  STANDARD_VIEWS[name] = STANDARD_VIEWS[short] = name;
}

/** 標準ビュー定義の、画面での名前（ADR-0014）。 */
const STD_LABEL: Record<string, string> = {
  GeneralView: "一般ビュー", InterconnectionView: "内部ブロック図", ActionFlowView: "アクティビティ図", StateTransitionView: "状態遷移図",
  SequenceView: "シーケンス図", GeometryView: "ジオメトリビュー", GridView: "グリッドビュー", BrowserView: "ブラウザビュー",
};
/**
 * 図の種類の、画面での名前（ADR-0014）。
 *
 * @param std 標準ビュー定義の名前（`GeneralView` など）。型の無い図は null
 * @returns 画面での名前。null なら「一般ビュー」、知らない名前ならその名前のまま
 * @example
 * stdViewLabel("SequenceView") // → "シーケンス図"
 * stdViewLabel(null)           // → "一般ビュー"
 * stdViewLabel("MyView")       // → "MyView"（知らない名前）
 */
export const stdViewLabel = (std: string | null): string => (std ? (STD_LABEL[std] ?? std) : "一般ビュー");

/**
 * 標準ビュー定義の名前か短い名前を、標準ビュー定義の名前にそろえる（短い名前 `afv` → `ActionFlowView`）。
 *
 * @param t 型の名前（修飾なし）
 * @returns 標準ビュー定義の名前。標準ビュー定義の名前でも短い名前でもなければ null
 * @example
 * standardViewName("afv")         // → "ActionFlowView"（短い名前）
 * standardViewName("GeneralView") // → "GeneralView"
 * standardViewName("MyView")      // → null
 */
export const standardViewName = (t: string): string | null => (Object.hasOwn(STANDARD_VIEWS, t) ? (STANDARD_VIEWS[t] ?? null) : null);
