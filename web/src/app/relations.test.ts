// 2 つの要素の間に追加できる関係の候補（F-EDIT-2）。要求をつなぐ関係は、線を引いた向きによらず出す。
import { describe, expect, it } from "vitest";
import { build, parse, type ModelNode } from "../core";
import { relOptions, reqRelOptions, type ReqRelEnd } from "./relations";

const end = (key: string, kind: string): ReqRelEnd => ({ key, kind });
const REQ = end("R", "requirement def");
const REQ2 = end("S", "requirement def");
const REQ_USE = end("r", "requirement");
const VER = end("V", "verification def");
const PART = end("P", "part def");
const PART_USE = end("p", "part");
const CONCERN = end("C", "concern def");

const SATISFY = { rel: "satisfy", label: "要求を満たす «satisfy»" };
const SATISFY_REV = { rel: "satisfy", label: "この部品で満たす «satisfy»", reverse: true };
const VERIFY = { rel: "verify", label: "要求を検証する «verify»" };
const VERIFY_REV = { rel: "verify", label: "この検証で確かめる «verify»", reverse: true };
const DERIVE = { rel: "derive", label: "この要求から導出する «derive»" };
const DERIVE_REV = { rel: "derive", label: "この要求へ展開する «derive»", reverse: true };

describe("reqRelOptions（要求をつなぐ関係を、線の向きによらず出す）", () => {
  it.each([
    ["要求 → 検証", REQ, VER, [VERIFY_REV]],
    ["検証 → 要求", VER, REQ, [VERIFY]],
    ["要求 → 部品定義", REQ, PART, [SATISFY_REV]],
    ["部品定義 → 要求", PART, REQ, [SATISFY]],
    ["要求 → 部品（使用）", REQ, PART_USE, [SATISFY_REV]],
    ["部品（使用）→ 要求", PART_USE, REQ, [SATISFY]],
    ["要求（使用）→ 部品定義", REQ_USE, PART, [SATISFY_REV]],
    ["要求（使用）→ 検証", REQ_USE, VER, [VERIFY_REV]],
    ["要求 → 別の要求", REQ, REQ2, [DERIVE, DERIVE_REV]],
    ["要求 → 関心事", REQ, CONCERN, [{ rel: "frame", label: "関心事を扱う «frame»" }]],
    ["関心事 → 要求", CONCERN, REQ, [{ rel: "frame", label: "この要求で扱う «frame»", reverse: true }]],
  ])("%s は、規格どおりの向きの関係を出す（同値分割）", (_, a, b, want) => {
    // Act
    const opts = reqRelOptions(a, b);
    // Assert
    expect(opts).toEqual(want);
  });

  it.each([
    ["部品定義 → 検証", PART, VER],
    ["検証 → 部品定義", VER, PART],
    ["部品定義 → 部品定義", PART, end("Q", "part def")],
    ["要求（使用）→ 要求（導出は要求定義どうしだけ）", REQ_USE, REQ],
  ])("%s は、要求をつなぐ関係が無い（異常系）", (_, a, b) => {
    // Act
    const opts = reqRelOptions(a, b);
    // Assert
    expect(opts).toEqual([]);
  });

  it("同じ要求どうしは、導出を出さない（境界値：自分自身）", () => {
    // Act
    const opts = reqRelOptions(REQ, REQ);
    // Assert
    expect(opts).toEqual([]);
  });
});

describe("relOptions（線を引いたときの関係の候補）", () => {
  const M = build(
    parse("package P { requirement def R; requirement def S; verification def V; part def H; part h : H; item def I; }"),
  );
  const n = (key: string): ModelNode => {
    const found = M.nodes.find((x) => x.key === key);
    if (!found) throw new Error(`${key} がありません`);
    return found;
  };

  it("要求から検証へ引くと、「〜として持つ」に並べて、検証で確かめる関係を出す（正常系）", () => {
    // Act
    const opts = relOptions(n("R"), n("V"));
    // Assert
    expect(opts).toEqual([{ rel: "comp", label: "検証として持つ" }, VERIFY_REV]);
  });

  it("検証から要求へ引くと、これまでどおり要求を検証する関係を出す（正常系）", () => {
    // Act
    const opts = relOptions(n("V"), n("R"));
    // Assert
    expect(opts).toEqual([{ rel: "comp", label: "要求として持つ" }, VERIFY]);
  });

  it("要求から部品（使用）へ引くと、部品で満たす関係を出す（定義ではないので持つは出さない）", () => {
    // Act
    const opts = relOptions(n("R"), n("h"));
    // Assert
    expect(opts).toEqual([SATISFY_REV]);
  });

  it("要求どうしは、「〜として持つ」と導出の両向きを出す（正常系）", () => {
    // Act
    const opts = relOptions(n("R"), n("S"));
    // Assert
    expect(opts).toEqual([{ rel: "comp", label: "要求として持つ" }, DERIVE, DERIVE_REV]);
  });

  it("要求と関係の無い組み合わせは、これまでどおり「〜として持つ」だけ（異常系）", () => {
    // Act
    const opts = relOptions(n("H"), n("I"));
    // Assert
    expect(opts).toEqual([{ rel: "comp", label: "アイテムとして持つ" }]);
  });
});
