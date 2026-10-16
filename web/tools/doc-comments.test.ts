// 関数の doc コメントの検査（programming-principles §4）。
import { describe, expect, it } from "vitest";
import { checkRust, checkTs, findRustFunctions, findTsFunctions, maskRust } from "./doc-comments";

const FULL_TS = `/**
 * 足す。
 *
 * @param a 1 つ目
 * @param b 2 つ目
 * @returns 和
 * @example
 * add(1, 2) // → 3
 */
export function add(a: number, b: number): number {
  return a + b;
}`;

describe("checkTs（TypeScript）", () => {
  it("概要・引数・戻り値・例がそろっていれば問題なし（正常系）", () => {
    expect(checkTs(FULL_TS)).toEqual([]);
  });

  it("doc コメントが無い関数を知らせる（異常系）", () => {
    expect(checkTs("function f(a: number): void {}")).toEqual([{ name: "f", line: 1, message: "doc コメント（/** … */）がありません" }]);
  });

  it("引数・戻り値・例の不足をそれぞれ知らせる", () => {
    // Arrange
    const src = "/** 足す。 */\nexport const add = (a: number, b: number): number => a + b;";
    // Act
    const msgs = checkTs(src).map((f) => f.message);
    // Assert
    expect(msgs).toEqual(["引数 a の @param がありません", "引数 b の @param がありません", "@returns がありません", "@example（入力と期待する出力）がありません"]);
  });

  it("値を返さない関数・コンストラクタには @returns と @example を求めない（境界値）", () => {
    // Arrange
    const src = "class C {\n  /**\n   * 作る。\n   * @param x 値\n   */\n  constructor(private readonly x: number) {}\n  /** 消す。 */\n  async clear(): Promise<void> {\n  }\n}";
    // Act・Assert
    expect(checkTs(src)).toEqual([]);
  });

  it("概要の無い doc コメントを知らせる（境界値）", () => {
    expect(checkTs("/**\n * @param a 値\n */\nfunction f(a: number): void {}").map((f) => f.message)).toEqual(["概要がありません"]);
  });

  it("関数の中の短い無名関数・呼び出しの文は対象にしない", () => {
    // Arrange
    const src = "/** 外。 */\nfunction outer(): void {\n  const inner = (x: number) => x + 1;\n  setText(r.text, { a: 1 });\n  if (x) {\n  }\n}";
    // Act・Assert
    expect(findTsFunctions(src).map((f) => f.sig.name)).toEqual(["outer"]);
  });

  it("オブジェクトのメソッドも対象にする", () => {
    // Arrange
    const src = "export const OPS = {\n  async addNode(kind: string): Promise<void> {\n  },\n};";
    // Act・Assert
    expect(findTsFunctions(src).map((f) => [f.sig.name, f.sig.params])).toEqual([["addNode", ["kind"]]]);
  });
});

describe("checkRust（Rust）", () => {
  it("概要・# 引数・# 戻り値・# 例がそろっていれば問題なし（正常系）", () => {
    // Arrange
    const src = "/// 足す。\n///\n/// # 引数\n///\n/// - `a`：1 つ目\n///\n/// # 戻り値\n///\n/// 和。\n///\n/// # 例\n///\n/// ```text\n/// add(1) → 2\n/// ```\n#[inline]\npub fn add(a: i32) -> i32 {\n    a + 1\n}";
    // Act・Assert
    expect(checkRust(src)).toEqual([]);
  });

  it("不足を知らせる。self は引数に数えない（異常系）", () => {
    // Arrange
    const src = "impl S {\n    /// 名前。\n    pub fn name(&self, i: usize) -> String {\n        String::new()\n    }\n}";
    // Act
    const msgs = checkRust(src).map((f) => f.message);
    // Assert
    expect(msgs).toEqual(["# 引数 に `i` がありません", "# 戻り値 がありません", "# 例（入力と期待する出力）がありません"]);
  });

  it("テストのモジュール・トレイトの実装・#[test] は対象にしない", () => {
    // Arrange
    const src = "impl fmt::Display for S {\n    fn fmt(&self, f: &mut F) -> R { Ok(()) }\n}\n#[cfg(test)]\nmod tests {\n    fn helper() -> u8 { 1 }\n}\n#[test]\nfn t() {}";
    // Act・Assert
    expect(findRustFunctions(src)).toEqual([]);
  });

  it("文字列の中の括弧に惑わされない（境界値）", () => {
    // Arrange
    const src = 'impl Display for S {\n    fn fmt(&self) -> R { write!(f, "{{") }\n}\nfn after() {}';
    // Act・Assert
    expect(findRustFunctions(src).map((f) => f.sig.name)).toEqual(["after"]);
    expect(maskRust('let s = "{}"; // }')).toBe('let s = "  ";     ');
  });

  it("複数行にまたがる宣言と、戻り値の無い関数", () => {
    // Arrange
    const src = "/// 足す。\n///\n/// # 引数\n///\n/// - `a`：値\n/// - `b`：値\nfn add(\n    a: i32,\n    b: i32,\n) {\n}";
    // Act・Assert
    expect(checkRust(src)).toEqual([]);
  });
});
