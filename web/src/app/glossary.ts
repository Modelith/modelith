// テキストの語の説明（F-EDIT-9、ADR-0014、docs/development/ui-writing.md）。
// SysML v2 の構文を知らない人に、キーワード・標準ビューの名前・よく使う標準ライブラリの名前の意味を、短い言葉で示す。
// 語の表と、テキストの位置から語を探して説明を返す純粋な関数だけを置く（画面への出し方は word-help.ts）。

import { standardViewName, stdViewLabel } from "../core";
import { kindLabel } from "./labels";

/** テキストの位置にある語と、その説明。 */
export interface WordHelp {
  /** 説明する語の範囲の始まり（UTF-16 の位置）。2 語のキーワード（`part def`）なら 1 語目の始まり */
  start: number;
  /** 説明する語の範囲の終わり（含まない） */
  end: number;
  /** 説明する語（`part def` のように空白 1 つでつないだもの） */
  term: string;
  /** 見出し。画面の言葉に、テキストの語を括弧で添える（「部品定義（part def）」） */
  title: string;
  /** 説明の本文 */
  text: string;
}

/**
 * キーワードの画面の言葉のうち、種類の名前（labels.ts の kindLabel）に無いもの。
 * 言葉は ui-writing の「言葉の対応」にそろえる。
 */
const TERMS = new Map<string, string>([
  ["satisfy", "満たす"], ["verify", "検証する"], ["frame", "扱う"], ["connect", "接続"], ["bind", "結び付け"],
  ["allocate", "割り当てる"], ["expose", "図に出す要素"], ["filter", "絞り込み"], ["render", "描き方の指定"],
  ["import", "インポート"], ["alias", "別名"], ["doc", "説明"], ["about", "メモを付ける相手"], ["rep", "別の言語での表し方"],
  ["language", "言語"], ["dependency", "依存する"], ["specializes", "定義を引き継ぐ（特殊化）"], ["subsets", "一部になる（部分集合）"],
  ["redefines", "置き換える（再定義）"], ["references", "参照する"], ["ref", "参照"], ["first", "最初"], ["then", "次に（順序）"],
  ["succession", "順序"], ["else", "それ以外のとき"], ["until", "繰り返しの終わり"], ["transition", "遷移"],
  ["entry", "入るときの振る舞い"], ["do", "その間の振る舞い"], ["exit", "出るときの振る舞い"], ["parallel", "並行の状態"],
  ["subject", "対象"], ["stakeholder", "関係者"], ["objective", "目的"], ["require", "満たすべき制約"], ["assume", "前提の制約"],
  ["assert", "必ず成り立つ制約"], ["in", "入力"], ["out", "出力"], ["inout", "入出力"], ["end", "接続の端"],
  ["private", "非公開"], ["public", "公開"], ["abstract", "抽象"], ["message", "メッセージ"], ["default", "既定値"],
  ["constant", "定数"], ["individual", "個体"], ["library", "ライブラリ"], ["metadata", "メタデータ"], ["return", "戻り値"],
  ["interface", "インタフェース"], ["use case", "ユースケース"], ["perform", "行うアクション"], ["exhibit", "示す状態"],
  ["and", "かつ"], ["or", "または"], ["not", "否定"], ["true", "真"], ["false", "偽"],
]);

/** キーワード（2 語・3 語のものを含む）の説明。見出しの言葉は TERMS か kindLabel から引く。 */
const KEYWORDS = new Map<string, string>([
  // 構造
  ["package", "要素をまとめる入れ物です。フォルダのように入れ子にできます。"],
  ["part def", "部品の型を定義します。同じ型の部品をいくつでも作れます（ブロック定義図の箱）。"],
  ["part", "全体の中の一部分になる部品です。部品定義を型にします。"],
  ["attribute def", "値の型（重さ・電圧など）を定義します。"],
  ["attribute", "部品などが持つ値（重さ・電圧など）です。"],
  ["port def", "ポートの型を定義します。ポートを通る物や信号を決めます。"],
  ["port", "部品の境界にある出入り口です。ほかの部品と接続するときに使います。"],
  ["item def", "部品の間を流れる物（水・信号・データなど）の型を定義します。"],
  ["item", "部品の間を流れる物（水・信号・データなど）です。"],
  ["enum def", "取りうる値を並べた型を定義します。"],
  ["enum", "列挙の値の 1 つです。"],
  ["interface def", "ポートどうしをつなぐ決まりを定義します。"],
  ["interface", "決まりに沿って、ポートどうしをつなぎます。"],
  ["connection def", "接続の型を定義します。"],
  ["connection", "部品やポートをつなぐ接続です。内部ブロック図の線になります。"],
  ["connect", "2 つ以上の部品やポートをつなぎます。"],
  ["binding", "2 つの値が常に等しいことを示します。"],
  ["bind", "2 つの値が常に等しいことを示します。"],
  ["flow def", "流れる物の型を定義します。"],
  ["flow", "部品やポートの間を、物や信号が流れることを示します。"],
  ["succession flow", "前の段階が終わってから流れる、順序付きの流れです。"],
  ["allocation def", "割り当ての型を定義します。"],
  ["allocation", "機能を部品に割り当てるなど、要素の対応を示します。"],
  ["allocate", "機能を部品に割り当てるなど、ある要素を別の要素に対応付けます。"],
  ["metadata def", "要素に付ける追加の情報の型を定義します。"],
  ["metadata", "要素に追加の情報を付けます。"],
  ["individual", "ただ 1 つの具体的なもの（この 1 台のケトルなど）を表します。"],
  ["ref", "持たずに参照するだけの特徴です。"],
  ["in", "外から受け取る向きです。"],
  ["out", "外へ出す向きです。"],
  ["inout", "受け取りも出しもする向きです。"],
  ["end", "接続の端です。"],
  ["default", "値を書かないときに使う値を書きます。"],
  ["constant", "変わらない値にします。"],
  ["abstract", "直接は使わず、引き継いで使う定義にします。"],
  ["private", "パッケージの外からは見えない要素にします。"],
  ["public", "パッケージの外からも見える要素にします。"],
  ["def", "定義を表します。前の語（part・action など）と組で、型を定義します。"],
  // 関係
  ["specializes", "別の定義を引き継いで、新しい定義を作ります（:> と同じ）。"],
  ["subsets", "別の特徴の一部であることを示します（:> と同じ）。"],
  ["redefines", "引き継いだ特徴を置き換えます（:>> と同じ）。"],
  ["references", "持たずに参照するだけであることを示します（::> と同じ）。"],
  ["dependency", "ある要素が別の要素に依存することを示します。"],
  // 要求と検証
  ["requirement def", "満たすべき条件（要求）を定義します。文章や制約で書きます。"],
  ["requirement", "満たすべき条件（要求）です。"],
  ["concern def", "関係者が気にかけていること（関心事）を定義します。"],
  ["concern", "関係者が気にかけていること（関心事）です。"],
  ["satisfy", "部品などが要求を満たすことを示します（トレーサビリティの線）。"],
  ["verify", "検証が、どの要求を確かめるかを示します。"],
  ["frame", "要求が扱う関心事を示します。"],
  ["subject", "要求や検証の対象になる要素です。"],
  ["stakeholder", "関心事を持つ関係者です。"],
  ["objective", "ケースや検証の目的です。"],
  ["require", "要求の中で、満たすべき制約を書きます。"],
  ["assume", "要求の前提になる制約を書きます。"],
  ["assert", "必ず成り立つ制約を書きます。"],
  ["verification def", "要求を確かめる方法（検証）を定義します。"],
  ["verification", "要求を確かめる手順と、その結果です。"],
  ["analysis def", "計算や評価で答えを出す解析を定義します。"],
  ["analysis", "計算や評価で答えを出す解析です。"],
  ["constraint def", "値が満たすべき条件（制約）を定義します。"],
  ["constraint", "値が満たすべき条件（制約）です。"],
  ["calc def", "値を求める計算を定義します。"],
  ["calc", "値を求める計算です。"],
  ["return", "計算の結果を書きます。"],
  ["case def", "目的を持った一連の手順（ケース）を定義します。"],
  ["case", "目的を持った一連の手順（ケース）です。"],
  ["use case def", "利用者がシステムで達成したいことを定義します。"],
  ["use case", "利用者がシステムで達成したいことです。"],
  ["include use case", "ほかのユースケースを、このユースケースの一部として含めます。"],
  ["actor", "システムの外から関わる人やものです。"],
  // 振る舞い
  ["action def", "振る舞いを定義します。中の順序や流れは、アクティビティ図で描きます。"],
  ["action", "行う振る舞いの 1 つの段階です。"],
  ["perform action", "部品が行うアクションを示します。"],
  ["perform", "部品が行うアクションを示します。"],
  ["first", "順序の始まり（最初に行うこと）を書きます。then と組で使います。"],
  ["then", "前の段階の次に行うことを書きます。"],
  ["succession", "前の段階が終わってから後の段階を行う、という順序を示します。"],
  ["fork", "流れをいくつかに分け、並行して進めます。"],
  ["join", "並行に分けた流れが、すべてそろってから進みます。"],
  ["decide", "条件によって、どれか 1 つの流れに進みます。"],
  ["merge", "いくつかの流れのうち、どれかが来たら進みます。"],
  ["send", "信号やメッセージを送ります。"],
  ["accept", "信号やメッセージを受け取るまで待ちます。遷移では、遷移のきっかけを書きます。"],
  ["assign", "値を代入します。"],
  ["terminate", "振る舞いを打ち切ります。"],
  ["if", "条件が成り立つときだけ行います。遷移や順序では、進む条件を書きます。"],
  ["else", "条件が成り立たないときに進む先を書きます。"],
  ["while", "条件が成り立つ間、繰り返します。"],
  ["loop", "繰り返します。until と組で、終わる条件を書けます。"],
  ["until", "繰り返しを終える条件を書きます。"],
  ["for", "集まりの要素ごとに繰り返します。"],
  ["message", "部品から部品へ送るものです。シーケンス図の矢印になります。"],
  ["state def", "状態の移り変わりを定義します。状態遷移図で描きます。"],
  ["state", "状態です。遷移によって別の状態に移ります。"],
  ["exhibit state", "部品が持つ状態の移り変わりを示します。"],
  ["exhibit", "部品が持つ状態の移り変わりを示します。"],
  ["transition", "きっかけと条件がそろうと、ある状態から別の状態に移ることを示します。"],
  ["entry", "状態に入るときに行う振る舞いを書きます。"],
  ["do", "状態にいる間に行う振る舞いを書きます。遷移の中では、遷移で行うことを書きます。"],
  ["exit", "状態から出るときに行う振る舞いを書きます。"],
  ["parallel", "中の状態が同時に進む状態にします。"],
  ["occurrence def", "時間の中で起きる出来事の流れ（シナリオ）を定義します。シーケンス図で描きます。"],
  ["occurrence", "時間の中で起きる出来事です。"],
  ["event occurrence", "ある時点で起きる出来事を示します。"],
  ["timeslice", "ある期間に起きている出来事です。"],
  ["snapshot", "ある時点の様子を表す出来事です。"],
  ["variant", "選べる候補の 1 つです。"],
  // 図と注釈
  ["view def", "図の種類を定義します。"],
  ["view", "テキストに保存された図です。どの要素を図に出すかを書きます。"],
  ["viewpoint def", "図を見る人の立場と、その人が知りたいことを定義します。"],
  ["viewpoint", "図を見る人の立場と、その人が知りたいことです。"],
  ["rendering def", "図の描き方を定義します。"],
  ["rendering", "図の描き方です。"],
  ["expose", "保存された図に出す要素を書きます。"],
  ["filter", "図に出す要素を、条件で絞り込みます。"],
  ["render", "図の描き方（表・ツリーなど）を指定します。"],
  ["import", "ほかのパッケージの要素を、パッケージの名前を付けずに使えるようにします。"],
  ["alias", "要素に別の名前を付けます。"],
  ["library", "標準などのライブラリのパッケージです。"],
  ["doc", "要素の説明を書きます。/* と */ の間が説明の本文です。"],
  ["comment", "要素に付けるメモです。/* と */ の間がメモの本文です。"],
  ["about", "メモを付ける相手の要素を書きます。"],
  ["rep", "要素を別の言語で表した本文です。"],
  ["language", "本文の言語の名前を書きます。"],
  // 式
  ["and", "両方が成り立つときに成り立ちます。"],
  ["or", "どちらかが成り立つときに成り立ちます。"],
  ["not", "成り立たないときに成り立ちます。"],
  ["true", "真（成り立つ）を表す値です。"],
  ["false", "偽（成り立たない）を表す値です。"],
]);

/** 図の種類（標準ビュー定義）ごとに、何を描く図か。 */
const VIEW_PURPOSE = new Map<string, string>([
  ["GeneralView", "要素とその関係を、箱と線で描きます（ブロック定義図や要求図に当たります）。"],
  ["InterconnectionView", "部品の中の部品とポート、その間の接続と流れを描きます。"],
  ["ActionFlowView", "アクションの順序と流れを描きます。"],
  ["StateTransitionView", "状態と、状態の間の遷移を描きます。"],
  ["SequenceView", "部品の間で送るメッセージを、時間の順に描きます。"],
  ["GeometryView", "部品の形と位置を描きます。"],
  ["GridView", "要素の関係を表で示します。"],
  ["BrowserView", "要素の入れ子をツリーで示します。"],
]);

/** よく使う標準ライブラリの名前（見出しと説明）。 */
const LIBRARY = new Map<string, [string, string]>([
  ["ScalarValues", ["基本の値の型", "真偽値・数・文字列の型をまとめた、標準ライブラリのパッケージです。"]],
  ["Boolean", ["真偽値", "true（真）か false（偽）のどちらかの値の型です（標準ライブラリ）。"]],
  ["String", ["文字列", "文字の並びの値の型です（標準ライブラリ）。"]],
  ["Integer", ["整数", "整数の値の型です（標準ライブラリ）。"]],
  ["Natural", ["0 以上の整数", "0 以上の整数の値の型です（標準ライブラリ）。"]],
  ["Positive", ["正の整数", "1 以上の整数の値の型です（標準ライブラリ）。"]],
  ["Rational", ["有理数", "分数で表せる数の値の型です（標準ライブラリ）。"]],
  ["Real", ["実数", "小数を含む数の値の型です（標準ライブラリ）。"]],
  ["Complex", ["複素数", "複素数の値の型です（標準ライブラリ）。"]],
  ["Number", ["数", "数の値の型です（標準ライブラリ）。"]],
  ["ISQ", ["量の型", "質量・長さ・時間などの量の型をまとめた、標準ライブラリのパッケージです（国際量体系 ISQ）。"]],
  ["SI", ["SI の単位", "kg・m・s などの単位をまとめた、標準ライブラリのパッケージです（国際単位系 SI）。"]],
  ["SIPrefixes", ["SI 接頭語", "キロ・ミリなどの接頭語をまとめた、標準ライブラリのパッケージです。"]],
  ["USCustomaryUnits", ["ヤード・ポンド法の単位", "インチ・ポンドなどの単位をまとめた、標準ライブラリのパッケージです。"]],
  ["Quantities", ["量の基本の型", "量の値の基本になる型をまとめた、標準ライブラリのパッケージです。"]],
  ["MeasurementReferences", ["単位と尺度の基本の型", "単位と尺度の基本になる型をまとめた、標準ライブラリのパッケージです。"]],
  ["Time", ["時刻と時間の型", "時刻と時間の型をまとめた、標準ライブラリのパッケージです。"]],
  ["MassValue", ["質量の値", "質量を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["LengthValue", ["長さの値", "長さを、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["DurationValue", ["時間の長さの値", "時間の長さを、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["SpeedValue", ["速さの値", "速さを、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["ForceValue", ["力の値", "力を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["EnergyValue", ["エネルギーの値", "エネルギーを、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["PowerValue", ["仕事率の値", "仕事率（電力など）を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["PressureValue", ["圧力の値", "圧力を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["AreaValue", ["面積の値", "面積を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["VolumeValue", ["体積の値", "体積を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["ElectricCurrentValue", ["電流の値", "電流を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["ThermodynamicTemperatureValue", ["温度の値", "温度（熱力学温度）を、数と単位の組で表す型です（標準ライブラリの ISQ）。"]],
  ["start", ["開始", "アクションの流れの始まりです（標準ライブラリ）。"]],
  ["done", ["終了", "アクションの流れの終わりです（標準ライブラリ）。"]],
]);

/** 単位の記号（見出しと説明）。数のすぐ後の `[ ]` の中と、`SI::` の後でだけ説明する（ほかの名前と取り違えないため）。 */
const UNITS = new Map<string, [string, string]>([
  ["kg", ["キログラム", "質量の単位です（国際単位系 SI）。"]],
  ["g", ["グラム", "質量の単位です（国際単位系 SI）。"]],
  ["m", ["メートル", "長さの単位です（国際単位系 SI）。"]],
  ["mm", ["ミリメートル", "長さの単位です（国際単位系 SI）。"]],
  ["cm", ["センチメートル", "長さの単位です（国際単位系 SI）。"]],
  ["km", ["キロメートル", "長さの単位です（国際単位系 SI）。"]],
  ["s", ["秒", "時間の単位です（国際単位系 SI）。"]],
  ["min", ["分", "時間の単位です（SI と併用する単位）。"]],
  ["h", ["時間", "時間の単位です（SI と併用する単位）。"]],
  ["W", ["ワット", "仕事率（電力など）の単位です（国際単位系 SI）。"]],
  ["kW", ["キロワット", "仕事率（電力など）の単位です（国際単位系 SI）。"]],
  ["J", ["ジュール", "エネルギーの単位です（国際単位系 SI）。"]],
  ["V", ["ボルト", "電圧の単位です（国際単位系 SI）。"]],
  ["A", ["アンペア", "電流の単位です（国際単位系 SI）。"]],
  ["N", ["ニュートン", "力の単位です（国際単位系 SI）。"]],
  ["Pa", ["パスカル", "圧力の単位です（国際単位系 SI）。"]],
  ["K", ["ケルビン", "温度の単位です（国際単位系 SI）。"]],
  ["Hz", ["ヘルツ", "周波数の単位です（国際単位系 SI）。"]],
]);

/** 語の並びのうち、いちどに説明する語の数の上限（`include use case` の 3 語）。 */
const MAX_PHRASE = 3;

/**
 * テキストを字句に分け、名前（識別子）の位置だけを返す。コメント・文字列・引用名・数の中の語は名前にしない。
 * 位置 offset の後ろは、名前を MAX_PHRASE 個まで読んだら止める。
 *
 * @param text テキスト
 * @param offset 調べる位置（UTF-16 の位置）
 * @returns 名前の範囲の並び（テキストの順）
 * @example
 * nameTokens("part def A; // part", 0) // → [{start:0,end:4},{start:5,end:8},{start:9,end:10}]（コメントの中の part は含まない）
 * nameTokens("x = 1e5;", 0)            // → [{start:0,end:1}]（数の中の e5 は名前にしない）
 */
function nameTokens(text: string, offset: number): { start: number; end: number }[] {
  const re = /\/\/\*[\s\S]*?(?:\*\/|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|\d[\w.]*|([A-Za-z_]\w*)/g;
  const out: { start: number; end: number }[] = [];
  let after = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] === undefined) continue;
    out.push({ start: m.index, end: m.index + m[1].length });
    if (m.index > offset && ++after >= MAX_PHRASE) break;
  }
  return out;
}

/**
 * キーワードの説明を、見出しと本文にする。
 *
 * @param term キーワード（`part def` のように空白 1 つでつないだもの）
 * @returns 見出しと本文。キーワードの表に無ければ null
 * @example
 * keywordHelp("part def") // → { title: "部品定義（part def）", text: "部品の型を定義します。…" }
 * keywordHelp("satisfy")  // → { title: "満たす（satisfy）", text: "部品などが要求を満たすことを示します…" }
 * keywordHelp("bogus")    // → null
 */
function keywordHelp(term: string): { title: string; text: string } | null {
  const text = KEYWORDS.get(term);
  if (text === undefined) return null;
  return { title: `${TERMS.get(term) ?? kindLabel(term)}（${term}）`, text };
}

/**
 * キーワードでない 1 語の説明を、見出しと本文にする（標準ビューの名前・標準ライブラリの名前・単位）。
 * 短い名前の図の種類（`afv`）は型の位置（`:`・`:>`・`::` の後）でだけ、単位は数の後の `[ ]` の中と `SI::` の後でだけ説明する。
 *
 * @param word 語
 * @param before 語の前のテキスト（文脈を見るのに使う。語のすぐ前まで）
 * @returns 見出しと本文。どれにも当たらなければ null
 * @example
 * nameHelp("ActionFlowView", "view v : ") // → { title: "アクティビティ図（SysML v2 の標準ビュー ActionFlowView）", … }
 * nameHelp("afv", "view v : ")            // → { title: "アクティビティ図（SysML v2 の標準ビュー ActionFlowView の短い名前 afv）", … }
 * nameHelp("afv", "part ")                // → null（型の位置でない短い名前）
 * nameHelp("W", "power = 1500 [")         // → { title: "ワット（W）", … }
 */
function nameHelp(word: string, before: string): { title: string; text: string } | null {
  const std = standardViewName(word);
  if (std !== null && (std === word || /[:>]\s*$/.test(before))) {
    const name = std === word ? std : `${std} の短い名前 ${word}`;
    return { title: `${stdViewLabel(std)}（SysML v2 の標準ビュー ${name}）`, text: VIEW_PURPOSE.get(std) ?? "" };
  }
  const lib = LIBRARY.get(word);
  if (lib) return { title: `${lib[0]}（${word}）`, text: lib[1] };
  const unit = UNITS.get(word);
  if (unit && /(\d\s*\[\s*|\bSI::)$/.test(before)) return { title: `${unit[0]}（${word}）`, text: unit[1] };
  return null;
}

/**
 * テキストの位置にある語を探し、その意味の説明を返す（F-EDIT-9）。語の始まりと終わりの位置も、その語に含める。
 * 空白だけで続くキーワードの並び（`part def`・`use case def`）は、まとめて 1 つの語として説明する。
 * コメント・文字列・引用名（`'…'`）の中の語と、表に無い語は説明しない。
 *
 * @param text テキスト
 * @param offset 位置（UTF-16 の位置。0 からテキストの長さまで）
 * @returns 語の範囲と説明。語が無い・説明の無い語・範囲外の位置なら null
 * @example
 * explainAt("part def Kettle;", 2)  // → { start: 0, end: 8, term: "part def", title: "部品定義（part def）", … }
 * explainAt("part def Kettle;", 8)  // → 同じ（語の終わりの位置）
 * explainAt("part def Kettle;", 12) // → null（利用者の付けた名前）
 * explainAt("// part", 4)           // → null（コメントの中）
 */
export function explainAt(text: string, offset: number): WordHelp | null {
  if (offset < 0 || offset > text.length) return null;
  const names = nameTokens(text, offset);
  const at = names.findIndex((w) => w.start <= offset && offset <= w.end);
  if (at < 0) return null;
  // 空白だけで隣り合う語の並びのうち、位置の語を含む最も長いキーワードを探す（同じ長さなら前から）
  const joined = (a: number, b: number): boolean =>
    names.slice(a, b).every((w, i) => /^\s+$/.test(text.slice(w.end, (names[a + i + 1] as { start: number }).start)));
  for (let len = Math.min(MAX_PHRASE, names.length); len >= 1; len--) {
    for (let a = Math.max(0, at - len + 1); a <= at && a + len <= names.length; a++) {
      if (!joined(a, a + len - 1)) continue;
      const first = names[a] as { start: number }, last = names[a + len - 1] as { end: number };
      const term = names.slice(a, a + len).map((w) => text.slice(w.start, w.end)).join(" ");
      const help = keywordHelp(term);
      if (help) return { start: first.start, end: last.end, term, ...help };
    }
  }
  const w = names[at] as { start: number; end: number };
  const word = text.slice(w.start, w.end);
  const help = nameHelp(word, text.slice(Math.max(0, w.start - 40), w.start));
  return help ? { start: w.start, end: w.end, term: word, ...help } : null;
}
