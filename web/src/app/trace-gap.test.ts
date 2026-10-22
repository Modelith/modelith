// トレースの抜けの案内の判断（F-TRACE-2）。
import { describe, expect, it } from "vitest";
import { findGap, gapCountLabel, gapGuide, gapKind, gapMarks, gapNodeAt, gapRelOptions, gapScreen, stepGap, type RangedNode } from "./trace-gap";

const node = (key: string, start: number, end: number): RangedNode => ({ key, entry: { start, end } });
// R は 10〜40、その中の S は 20〜30、離れた T は 50〜60
const NODES = [node("R", 10, 40), node("S", 20, 30), node("T", 50, 60)];

const VERIFY = "K3 R：この要求を確かめる検証がありません（verify）";
const SATISFY = "K3 R：この要求を満たす要素がありません（satisfy）";
const SOURCE = "S S：導出元の上位の要求がありません（derivation）";
const EXPAND = "N1 Need：どの下位の要求にも展開されていません（derivation）";

describe("gapNodeAt（抜けの位置から図の要素を引く）", () => {
  it("宣言の始まりの位置なら、その要素を引く（正常系）", () => {
    // Arrange
    const pos = 50;
    // Act
    const n = gapNodeAt(NODES, pos);
    // Assert
    expect(n?.key).toBe("T");
  });

  it("入れ子の範囲の中なら、最も内側の要素を引く（同値分割）", () => {
    // Arrange
    const pos = 25;
    // Act
    const n = gapNodeAt(NODES, pos);
    // Assert
    expect(n?.key).toBe("S");
  });

  it("範囲の始まりは含み、終わりは含まない（境界値）", () => {
    // Arrange
    const positions = [10, 39, 40];
    // Act
    const keys = positions.map((p) => gapNodeAt(NODES, p)?.key ?? null);
    // Assert
    expect(keys).toEqual(["R", "R", null]);
  });

  it("どの要素の範囲にも無い位置・要素が無いときは null（異常系）", () => {
    // Arrange
    const cases: [readonly RangedNode[], number][] = [[NODES, 45], [NODES, -1], [[], 0]];
    // Act
    const found = cases.map(([ns, p]) => gapNodeAt(ns, p));
    // Assert
    expect(found).toEqual([null, null, null]);
  });
});

describe("gapKind（抜けの種類の判断）", () => {
  it("コアの 4 つの文を、展開・導出元・満たす要素・検証に分ける（正常系）", () => {
    // Arrange
    const msgs = [EXPAND, SOURCE, SATISFY, VERIFY];
    // Act
    const kinds = msgs.map(gapKind);
    // Assert
    expect(kinds).toEqual(["expand", "source", "satisfy", "verify"]);
  });

  it("名前に「下位」が入っていても、導出元の抜けを展開と見誤らない（同値分割）", () => {
    // Arrange
    const msg = "下位Req 下位Req：導出元の上位の要求がありません（derivation）";
    // Act
    const kind = gapKind(msg);
    // Assert
    expect(kind).toBe("source");
  });

  it("末尾の括弧が無い・知らない文は null（異常系）", () => {
    // Arrange
    const msgs = ["参照先が見つかりません", "（verify）の後ろに文がある", ""];
    // Act
    const kinds = msgs.map(gapKind);
    // Assert
    expect(kinds).toEqual([null, null, null]);
  });
});

describe("gapGuide（種類ごとの案内の文）", () => {
  it("種類ごとに、何が足りないかと「関係を追加」での直し方を図の言葉で書き、SysML v2 の言葉は括弧に回す（正常系）", () => {
    // Arrange
    const kinds = ["expand", "source", "satisfy", "verify"] as const;
    // Act
    const guides = kinds.map((k) => gapGuide(k, ""));
    // Assert
    expect(guides).toEqual([
      { lack: "この要求は、どの下位の要求にも展開されていません", fix: "「関係を追加」を押して、ここから導き出す下位の要求を選ぶと解消します（derivation）", target: "下位の要求" },
      { lack: "この要求の導出元になる上位の要求がありません", fix: "「関係を追加」を押して、導出元の上位の要求を選ぶと解消します（derivation）", target: "上位の要求" },
      { lack: "この要求を満たす部品がありません", fix: "「関係を追加」を押して、この要求を満たす部品を選ぶと解消します（satisfy）", target: "部品" },
      { lack: "この要求を確かめる検証がありません", fix: "「関係を追加」を押して、検証の要素を選ぶと解消します（verify）", target: "検証の要素" },
    ]);
  });

  it("種類が分からなければ、元の文を見せてテキストで確かめるよう案内し、つなぐ相手は示さない（異常系）", () => {
    // Arrange
    const msg = "R：何かが足りません";
    // Act
    const guide = gapGuide(null, msg);
    // Assert
    expect(guide).toEqual({ lack: msg, fix: "「テキストで見る」で、該当の行を確かめてください", target: null });
  });
});

describe("gapMarks（図の上の印のツールチップ）", () => {
  const keyAt = (pos: number): string | null => gapNodeAt(NODES, pos)?.key ?? null;

  it("要素ごとに、足りないものを行に分けて並べる（正常系）", () => {
    // Arrange
    const gaps = [{ pos: 10, msg: SATISFY }, { pos: 10, msg: VERIFY }, { pos: 20, msg: SOURCE }];
    // Act
    const marks = gapMarks(gaps, keyAt);
    // Assert
    expect([...marks]).toEqual([
      ["R", "トレースの抜け：\nこの要求を満たす部品がありません\nこの要求を確かめる検証がありません"],
      ["S", "トレースの抜け：\nこの要求の導出元になる上位の要求がありません"],
    ]);
  });

  it("抜けが無ければ空、図の要素が見つからない抜けは印にしない（境界値・異常系）", () => {
    // Arrange
    const cases = [[], [{ pos: 45, msg: VERIFY }]];
    // Act
    const sizes = cases.map((gaps) => gapMarks(gaps, keyAt).size);
    // Assert
    expect(sizes).toEqual([0, 0]);
  });
});

describe("stepGap（前後のボタンで移る先）", () => {
  it("途中では、次は 1 つ後・前は 1 つ前（正常系）", () => {
    // Arrange
    const total = 3;
    // Act
    const moves = [stepGap(1, total, 1), stepGap(1, total, -1)];
    // Assert
    expect(moves).toEqual([2, 0]);
  });

  it("両端で回る：最後の次は先頭、先頭の前は最後（境界値）", () => {
    // Arrange
    const total = 3;
    // Act
    const moves = [stepGap(2, total, 1), stepGap(0, total, -1)];
    // Assert
    expect(moves).toEqual([0, 2]);
  });

  it("1 件なら、前後どちらでも同じ所（境界値）", () => {
    // Arrange
    const total = 1;
    // Act
    const moves = [stepGap(0, total, 1), stepGap(0, total, -1)];
    // Assert
    expect(moves).toEqual([0, 0]);
  });

  it("0 件なら移らない（境界値）", () => {
    // Arrange
    const total = 0;
    // Act
    const move = stepGap(0, total, 1);
    // Assert
    expect(move).toBeNull();
  });

  it("範囲の外の番号は、範囲に収めてから移る（異常系）", () => {
    // Arrange
    const total = 3;
    // Act
    const moves = [stepGap(5, total, 1), stepGap(-2, total, -1)];
    // Assert
    expect(moves).toEqual([0, 2]);
  });
});

describe("gapCountLabel（何件目かの表示）", () => {
  it("番号を 1 から数えて「1 / 3 件目」にする（正常系・境界値）", () => {
    // Arrange
    const cases: [number, number][] = [[0, 3], [2, 3], [0, 1]];
    // Act
    const labels = cases.map(([i, n]) => gapCountLabel(i, n));
    // Assert
    expect(labels).toEqual(["1 / 3 件目", "3 / 3 件目", "1 / 1 件目"]);
  });
});

describe("gapScreen（どちらの画面で示すか）", () => {
  it("広い画面では、見ているタブにかかわらず図で示す（同値分割）", () => {
    // Arrange
    const tabs = ["diagram", "text", "tree", undefined];
    // Act
    const screens = tabs.map((t) => gapScreen(false, t));
    // Assert
    expect(screens).toEqual(["diagram", "diagram", "diagram", "diagram"]);
  });

  it("狭い画面では、図のタブなら図、テキスト・ツリーのタブならテキストで示す（同値分割）", () => {
    // Arrange
    const tabs = ["diagram", "text", "tree", undefined];
    // Act
    const screens = tabs.map((t) => gapScreen(true, t));
    // Assert
    expect(screens).toEqual(["diagram", "text", "text", "text"]);
  });
});

describe("findGap（案内している抜けの、今の番号）", () => {
  const keyAt = (pos: number): string | null => gapNodeAt(NODES, pos)?.key ?? null;

  it("同じ要素の同じ文の抜けがあれば、その番号（正常系）", () => {
    // Arrange
    const gaps = [{ pos: 10, msg: SATISFY }, { pos: 10, msg: VERIFY }, { pos: 20, msg: SOURCE }];
    // Act
    const found = findGap(gaps, keyAt, { key: "R", msg: VERIFY });
    // Assert
    expect(found).toEqual({ index: 1, total: 3 });
  });

  it("テキストが変わって位置がずれても、要素のキーで同じ抜けを探す（同値分割）", () => {
    // Arrange（R の宣言が 10 から 12 にずれた）
    const moved = [node("R", 12, 42)];
    const gaps = [{ pos: 12, msg: VERIFY }];
    // Act
    const found = findGap(gaps, (p) => gapNodeAt(moved, p)?.key ?? null, { key: "R", msg: VERIFY });
    // Assert
    expect(found).toEqual({ index: 0, total: 1 });
  });

  it("その抜けが解消していれば、同じ要素の別の抜け（同値分割）", () => {
    // Arrange
    const gaps = [{ pos: 20, msg: SOURCE }, { pos: 10, msg: SATISFY }];
    // Act
    const found = findGap(gaps, keyAt, { key: "R", msg: VERIFY });
    // Assert
    expect(found).toEqual({ index: 1, total: 2 });
  });

  it("要素の抜けがすべて解消していれば、解消済みと残りの件数（境界値：残り 1 件・0 件）", () => {
    // Arrange
    const cases = [[{ pos: 20, msg: SOURCE }], []];
    // Act
    const found = cases.map((gaps) => findGap(gaps, keyAt, { key: "R", msg: VERIFY }));
    // Assert
    expect(found).toEqual([{ resolved: true, total: 1 }, { resolved: true, total: 0 }]);
  });
});

describe("gapRelOptions（案内から関係を追加するときの候補）", () => {
  const R = { key: "R", kind: "requirement def" };

  it("抜けの種類ごとに、解消できる相手と関係の向きを返す（正常系）", () => {
    // Arrange
    const cases = [
      gapRelOptions("verify", R, { key: "V", kind: "verification def" }),
      gapRelOptions("satisfy", R, { key: "P", kind: "part def" }),
      gapRelOptions("source", R, { key: "U", kind: "requirement def" }),
      gapRelOptions("expand", R, { key: "L", kind: "requirement def" }),
    ];
    // Act
    const picked = cases.map((os) => os.map((o) => [o.rel, o.reverse]));
    // Assert
    expect(picked).toEqual([[["verify", true]], [["satisfy", true]], [["derive", false]], [["derive", true]]]);
  });

  it("部品の使用（part）でも満たす関係を返す（同値分割）", () => {
    // Arrange
    const part = { key: "p", kind: "part" };
    // Act
    const options = gapRelOptions("satisfy", R, part);
    // Assert
    expect(options.map((o) => o.label)).toEqual(["この部品で満たす «satisfy»"]);
  });

  it("解消できない相手・自分自身・図の記号には候補を出さない（異常系）", () => {
    // Arrange
    const cases = [
      gapRelOptions("verify", R, { key: "P", kind: "part def" }),
      gapRelOptions("source", R, R),
      gapRelOptions("satisfy", R, { key: "n", kind: "part", note: true }),
      gapRelOptions("expand", R, { key: "C", kind: "concern def" }),
    ];
    // Act
    const counts = cases.map((os) => os.length);
    // Assert
    expect(counts).toEqual([0, 0, 0, 0]);
  });
});
