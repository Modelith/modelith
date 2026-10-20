// テキストの語の説明（F-EDIT-9、ADR-0014）。
import { describe, expect, it } from "vitest";
import { explainAt } from "./glossary";

describe("explainAt（位置にある語を探す）", () => {
  it("キーワードの中の位置で、その語と説明を返す（正常系）", () => {
    // Arrange
    const text = "satisfy Req by Kettle;";
    // Act
    const help = explainAt(text, 3);
    // Assert
    expect(help).toMatchObject({ start: 0, end: 7, term: "satisfy", title: "満たす（satisfy）" });
    expect(help?.text).toContain("要求を満たす");
  });

  it("語の始まりの位置は、その語に含める（境界値）", () => {
    // Arrange
    const text = "x; satisfy Req;";
    // Act
    const help = explainAt(text, 3);
    // Assert
    expect(help?.term).toBe("satisfy");
  });

  it("語の終わりの位置（語のすぐ後ろのカーソル）も、その語に含める（境界値）", () => {
    // Arrange
    const text = "satisfy;";
    // Act
    const help = explainAt(text, 7);
    // Assert
    expect(help?.term).toBe("satisfy");
  });

  it("語に接していない空白の位置では null（境界値）", () => {
    // Arrange
    const text = "satisfy   Req;";
    // Act
    const help = explainAt(text, 8);
    // Assert
    expect(help).toBeNull();
  });

  it("テキストの終わりの位置で、最後の語を返す（境界値）", () => {
    // Arrange
    const text = "  package";
    // Act
    const help = explainAt(text, text.length);
    // Assert
    expect(help).toMatchObject({ start: 2, end: 9, term: "package", title: "パッケージ（package）" });
  });

  it("テキストの範囲外の位置と、空のテキストでは null（異常系）", () => {
    // Arrange
    const text = "package P;";
    // Act
    const helps = [explainAt(text, -1), explainAt(text, text.length + 1), explainAt("", 0)];
    // Assert
    expect(helps).toEqual([null, null, null]);
  });

  it("表に無い語（利用者の付けた名前）は null（異常系）", () => {
    // Arrange
    const text = "part def Kettle;";
    // Act
    const help = explainAt(text, 12);
    // Assert
    expect(help).toBeNull();
  });

  it("大文字の違う語はキーワードとみなさない（異常系）", () => {
    // Arrange
    const text = "Satisfy";
    // Act
    const help = explainAt(text, 2);
    // Assert
    expect(help).toBeNull();
  });
});

describe("explainAt（コメントと文字列の中の語は説明しない）", () => {
  const cases: [string, string, string][] = [
    ["行のコメント", "// part は部品", "part"],
    ["コメントの本文", "/* the part */", "part"],
    ["doc の本文", "doc /* a part of it */", "part"],
    ["注記（//* … */）", "//* part\n */", "part"],
    ["閉じていないコメント", "/* part", "part"],
    ["文字列", 'language "part";', "part"],
    ["引用名", "part 'part' : P;", "'part'"],
  ];
  for (const [label, text, word] of cases) {
    it(`${label}の中の語は null`, () => {
      // Arrange（同値クラスごとの代表値）
      const offset = text.indexOf(word) + 2;
      // Act
      const help = explainAt(text, offset);
      // Assert
      expect(help).toBeNull();
    });
  }

  it("コメントの後ろの語は説明する（コメントの終わりの境界）", () => {
    // Arrange
    const text = "/* x */ part p;";
    // Act
    const help = explainAt(text, 9);
    // Assert
    expect(help?.term).toBe("part");
  });

  it("数の中の文字（1e5 の e5）は語にしない", () => {
    // Arrange
    const text = "x = 1e5;";
    // Act
    const help = explainAt(text, 6);
    // Assert
    expect(help).toBeNull();
  });
});

describe("explainAt（2 語・3 語のキーワード）", () => {
  it("1 語目の位置で、2 語のキーワードをまとめて説明する", () => {
    // Arrange
    const text = "part def Kettle;";
    // Act
    const help = explainAt(text, 0);
    // Assert
    expect(help).toMatchObject({ start: 0, end: 8, term: "part def", title: "部品定義（part def）" });
  });

  it("2 語目の終わりの位置でも、2 語のキーワードをまとめて説明する（境界値）", () => {
    // Arrange
    const text = "part def Kettle;";
    // Act
    const help = explainAt(text, 8);
    // Assert
    expect(help?.term).toBe("part def");
  });

  it("改行をはさんだ 2 語も、まとめて説明する", () => {
    // Arrange
    const text = "action\n    def Fill;";
    // Act
    const help = explainAt(text, 12);
    // Assert
    expect(help).toMatchObject({ start: 0, end: 14, term: "action def", title: "アクション定義（action def）" });
  });

  it("コメントをはさんだ 2 語は、まとめない", () => {
    // Arrange
    const text = "part /* x */ def";
    // Act
    const help = explainAt(text, 1);
    // Assert
    expect(help?.term).toBe("part");
  });

  it("3 語のキーワード（use case def）は、真ん中の語の位置でもまとめて説明する", () => {
    // Arrange
    const text = "use case def Boil;";
    // Act
    const help = explainAt(text, 5);
    // Assert
    expect(help).toMatchObject({ start: 0, end: 12, term: "use case def", title: "ユースケース定義（use case def）" });
  });

  it("前に別のキーワードが続いても、位置の語を含む最も長いキーワードを選ぶ（exhibit state）", () => {
    // Arrange
    const text = "part k { exhibit state s; }";
    // Act
    const help = explainAt(text, text.indexOf("state") + 1);
    // Assert
    expect(help?.term).toBe("exhibit state");
  });

  it("後ろに名前が続く 1 語のキーワードは、その語だけを説明する", () => {
    // Arrange
    const text = "part heater : Heater;";
    // Act
    const help = explainAt(text, 2);
    // Assert
    expect(help).toMatchObject({ start: 0, end: 4, term: "part", title: "部品（part）" });
  });
});

describe("explainAt（キーワードの表）", () => {
  // 利用者がテキストで出会う主なキーワード。どれも、キーワードのままでない画面の言葉で説明する（ui-writing の決まり 3）
  const keywords = [
    "part", "part def", "port", "port def", "attribute", "attribute def", "item", "action", "action def", "state", "state def",
    "transition", "requirement", "requirement def", "satisfy", "verify", "connect", "connection", "flow", "bind", "binding",
    "allocate", "allocation", "view", "expose", "filter", "render", "package", "import", "alias", "doc", "comment", "about",
    "first", "then", "fork", "join", "merge", "decide", "send", "accept", "assign", "terminate", "if", "else", "while", "loop",
    "for", "entry", "do", "exit", "parallel", "perform action", "exhibit state", "succession flow", "dependency", "specializes",
    "subsets", "redefines", "references", "use case", "include use case", "occurrence def", "verification def", "concern",
    "constraint", "calc", "enum def", "interface def", "metadata", "rep", "language", "in", "out", "inout", "end", "ref",
  ];
  for (const kw of keywords) {
    it(`「${kw}」を画面の言葉で説明する`, () => {
      // Arrange
      const text = `${kw} x;`;
      // Act
      const help = explainAt(text, 0);
      // Assert
      expect(help?.term).toBe(kw);
      expect(help?.title.endsWith(`（${kw}）`)).toBe(true);
      expect(help?.title.startsWith(kw)).toBe(false);
      expect(help?.text.length).toBeGreaterThan(0);
    });
  }
});

describe("explainAt（標準ビューの名前）", () => {
  const views: [string, string, string][] = [
    ["GeneralView", "gv", "一般ビュー"],
    ["InterconnectionView", "iv", "内部ブロック図"],
    ["ActionFlowView", "afv", "アクティビティ図"],
    ["StateTransitionView", "stv", "状態遷移図"],
    ["SequenceView", "sv", "シーケンス図"],
    ["GeometryView", "gev", "ジオメトリビュー"],
    ["GridView", "grv", "グリッドビュー"],
    ["BrowserView", "bv", "ブラウザビュー"],
  ];
  for (const [std, short, label] of views) {
    it(`${std} は「${label}」と、SysML v2 の名前を補足にして説明する`, () => {
      // Arrange
      const text = `view v : ${std};`;
      // Act
      const help = explainAt(text, text.indexOf(std));
      // Assert
      expect(help?.title).toBe(`${label}（SysML v2 の標準ビュー ${std}）`);
      expect(help?.text.length).toBeGreaterThan(0);
    });

    it(`短い名前 ${short} も、型の位置では「${label}」と説明する`, () => {
      // Arrange
      const text = `view v : ${short} { }`;
      // Act
      const help = explainAt(text, text.indexOf(short) + 1);
      // Assert
      expect(help?.title).toBe(`${label}（SysML v2 の標準ビュー ${std} の短い名前 ${short}）`);
    });
  }

  it("修飾した短い名前（Views::afv）も説明する", () => {
    // Arrange
    const text = "view v : Views::afv;";
    // Act
    const help = explainAt(text, text.indexOf("afv"));
    // Assert
    expect(help?.term).toBe("afv");
  });

  it("型の位置でない短い名前は、利用者の付けた名前とみなして説明しない（異常系）", () => {
    // Arrange
    const text = "part iv : Inverter;";
    // Act
    const help = explainAt(text, 5);
    // Assert
    expect(help).toBeNull();
  });
});

describe("explainAt（標準ライブラリの名前と単位）", () => {
  it("基本の値の型（Real）を説明する", () => {
    // Arrange
    const text = "attribute capacity : Real;";
    // Act
    const help = explainAt(text, text.indexOf("Real"));
    // Assert
    expect(help).toMatchObject({ term: "Real", title: "実数（Real）" });
  });

  it("量の型（ISQ::MassValue）は、パッケージと型のそれぞれを説明する", () => {
    // Arrange
    const text = "attribute mass : ISQ::MassValue;";
    // Act
    const helps = [explainAt(text, text.indexOf("ISQ")), explainAt(text, text.indexOf("MassValue"))];
    // Assert
    expect(helps.map((h) => h?.title)).toEqual(["量の型（ISQ）", "質量の値（MassValue）"]);
  });

  it("数の後の [ ] の中の単位を説明する", () => {
    // Arrange
    const text = "attribute power = 1500 [W];";
    // Act
    const help = explainAt(text, text.indexOf("W]"));
    // Assert
    expect(help).toMatchObject({ term: "W", title: "ワット（W）" });
  });

  it("SI:: の後の単位を説明する", () => {
    // Arrange
    const text = "attribute m = 2 * SI::kg;";
    // Act
    const help = explainAt(text, text.indexOf("kg"));
    // Assert
    expect(help?.title).toBe("キログラム（kg）");
  });

  it("単位と同じ名前でも、単位の位置でなければ説明しない（異常系）", () => {
    // Arrange
    const text = "part W : Wheel;";
    // Act
    const help = explainAt(text, 5);
    // Assert
    expect(help).toBeNull();
  });
});
