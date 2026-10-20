// 画面に出す種類の名前（ADR-0014、docs/development/ui-writing.md）。
// 利用者は SysML v2 の構文を覚えていないので、画面では図の言葉を使い、キーワードは補足にする。

const KIND_LABEL: Record<string, string> = {
  "part def": "部品定義", part: "部品", "attribute def": "属性定義", attribute: "属性", "port def": "ポート定義", port: "ポート",
  "item def": "アイテム定義", item: "アイテム", "requirement def": "要求", requirement: "要求", "concern def": "関心事", concern: "関心事",
  "verification def": "検証", verification: "検証", "analysis def": "解析", analysis: "解析", "constraint def": "制約定義", constraint: "制約",
  "calc def": "計算定義", calc: "計算", "state def": "状態定義", state: "状態", "action def": "アクション定義", action: "アクション",
  "exhibit state": "状態", "perform action": "アクション",
  "occurrence def": "シナリオ", occurrence: "出来事", "interface def": "インタフェース定義", "connection def": "接続定義",
  "allocation def": "割り当て定義", allocation: "割り当て", connection: "接続", binding: "結び付け",
  "flow def": "流れの定義", flow: "流れ",
  "use case def": "ユースケース定義", "enum def": "列挙定義", "metadata def": "メタデータ定義", "view def": "図の定義", view: "保存された図",
  package: "パッケージ",
  // alpha.7 で読むようにした種類（ツリーとツールチップに出る）
  "case def": "ケース定義", case: "ケース", actor: "アクター", "include use case": "含めるユースケース", enum: "列挙",
  "event occurrence": "出来事", timeslice: "期間の出来事", snapshot: "時点の出来事", variant: "バリアント",
  "viewpoint def": "視点の定義", viewpoint: "視点", "rendering def": "描き方の定義", rendering: "描き方",
  def: "定義（利用者定義のキーワード）", usage: "使用（利用者定義のキーワード）",
  // alpha.8 で読むようにした種類
  comment: "メモ",
  // alpha.9 で読むようにした種類（アクションの流れ、8.2.2.17）
  fork: "分岐（並行）", join: "合流（並行）", decide: "分岐（条件）", merge: "合流（条件）",
  send: "送信", accept: "受信", assign: "代入", terminate: "打ち切り",
  if: "条件付きの実行", while: "繰り返し", loop: "繰り返し", for: "要素ごとの繰り返し",
  start: "開始", done: "終了", "succession flow": "順序付きの流れ",
};

/**
 * 要素の種類の、画面での名前を返す（ADR-0014）。知らない種類は SysML v2 のキーワードのまま返す。
 *
 * @param kind 要素の種類（SysML v2 のキーワード。`part def`・`requirement`・`package` など）
 * @returns 画面に出す名前。表に無い種類なら kind そのもの
 * @example
 * kindLabel("part def")  // → "部品定義"
 * kindLabel("view")      // → "保存された図"
 * kindLabel("flow def")  // → "流れの定義"
 * kindLabel("send")      // → "送信"
 * kindLabel("bogus")     // → "bogus"（表に無い種類）
 */
export const kindLabel = (kind: string): string => KIND_LABEL[kind] ?? kind;

/**
 * ビュー（図の種類）の名前を、「〜の図」と呼べる形にする。名前が「図」で終わればそのまま、そうでなければ「の図」を付ける。
 * 保存する図の名前の候補や、トーストの「〜には出ていません」に使う。
 *
 * @param label ビューの画面での名前（「トレーサビリティ」・「ブロック定義図」など）
 * @returns 図の呼び名
 * @example
 * diagramName("トレーサビリティ") // → "トレーサビリティの図"
 * diagramName("ブロック定義図")   // → "ブロック定義図"（「図」で終わる）
 * diagramName("")                 // → "の図"（空の名前）
 */
export const diagramName = (label: string): string => (label.endsWith("図") ? label : `${label}の図`);
