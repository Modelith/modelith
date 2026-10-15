import { describe, expect, it } from "vitest";
import { compareVersions, FOOTER, isPrerelease, isVersion, previousVersion, skeleton, TODO, validate } from "./release-notes";

/** 形の正しいノート。 */
const good = (version = "0.1.0-alpha.4", upgrade = "") =>
  `# Modelith ${version}\n\n要約です。\n\n## 主な変更\n\n- 図：速くなりました\n\n${upgrade}${FOOTER}`;

describe("skeleton", () => {
  it("前の版があれば「をお使いの方へ」の節を入れ、決まった部分を最後に付ける", () => {
    // Act
    const s = skeleton("0.1.0-alpha.4", "0.1.0-alpha.3");
    // Assert
    expect(s.startsWith("# Modelith 0.1.0-alpha.4\n")).toBe(true);
    expect(s).toContain("## 0.1.0-alpha.3 をお使いの方へ");
    expect(s.endsWith(FOOTER)).toBe(true);
  });

  it("ひな形のままでは、埋めていない箇所があるとして検査に落ちる（異常系）", () => {
    // Act
    const problems = validate("0.1.0-alpha.4", skeleton("0.1.0-alpha.4"));
    // Assert
    expect(problems).toEqual([`埋めていない箇所「${TODO}」が残っています`]);
  });
});

describe("validate", () => {
  it("形の正しいノートは問題が無い（前の版の節あり・なし）", () => {
    // Act・Assert
    expect(validate("0.1.0-alpha.4", good())).toEqual([]);
    expect(validate("0.1.0-alpha.4", good("0.1.0-alpha.4", "## 0.1.0-alpha.3 をお使いの方へ\n\n- そのまま開けます\n\n"))).toEqual([]);
  });

  it("改行が CRLF でも同じに扱う（GitHub の画面で編集した本文）", () => {
    // Act・Assert
    expect(validate("0.1.0-alpha.4", good().replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it("1 行目の版がファイル名と違えば落ちる（異常系）", () => {
    // Act
    const problems = validate("0.1.0-alpha.5", good("0.1.0-alpha.4"));
    // Assert
    expect(problems).toContain("1 行目は「# Modelith 0.1.0-alpha.5」にしてください");
  });

  it("要約が無い・主な変更が無い・決まっていない節がある・決まった部分を変えた、をそれぞれ知らせる（異常系）", () => {
    // Arrange
    const text = `# Modelith 0.1.0-alpha.4\n\n## 開発者向け\n\n- ADR を足した\n\n${FOOTER.replace("無保証", "保証なし")}`;
    // Act
    const problems = validate("0.1.0-alpha.4", text);
    // Assert
    expect(problems).toEqual([
      "1 行目の後に、この版の要約を 1 段落で書いてください",
      "要約の次の節は「## 主な変更」にしてください",
      "決まっていない節があります：## 開発者向け（使えるのは「## 主な変更」と「## <前の版> をお使いの方へ」）",
      "「## 主な変更」に箇条書き（- ）を 1 つ以上書いてください",
      "最後は決まった部分（ご注意・商標・ライセンス）をそのまま付けてください（release-notes-cli.ts new で入ります）",
    ]);
  });
});

describe("版", () => {
  it.each([
    ["0.1.0", true],
    ["0.1.0-alpha.4", true],
    ["v0.1.0", false],
    ["0.1", false],
  ])("isVersion(%s) = %s", (v, expected) => {
    expect(isVersion(v)).toBe(expected);
  });

  it("段階の付いた版はプレリリース", () => {
    expect([isPrerelease("0.1.0-rc.1"), isPrerelease("0.1.0")]).toEqual([true, false]);
  });

  it("SemVer の順に並べる（段階の番号は数として比べ、段階の無い版がいちばん後）", () => {
    // Arrange
    const vs = ["0.1.0", "0.1.0-alpha.10", "0.1.0-beta.1", "0.1.0-alpha.2", "0.1.0-rc.1"];
    // Act
    const sorted = [...vs].sort(compareVersions);
    // Assert
    expect(sorted).toEqual(["0.1.0-alpha.2", "0.1.0-alpha.10", "0.1.0-beta.1", "0.1.0-rc.1", "0.1.0"]);
  });

  it("直前の版を選ぶ（無ければ undefined）", () => {
    // Act・Assert
    expect(previousVersion("0.1.0-alpha.4", ["0.1.0-alpha.2", "0.1.0-alpha.3", "0.1.0-beta.1"])).toBe("0.1.0-alpha.3");
    expect(previousVersion("0.1.0-alpha.1", ["0.1.0-alpha.2"])).toBeUndefined();
  });
});
