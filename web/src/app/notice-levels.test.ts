// 知らせの重さ（F-EDIT-11）の画面の言葉と、問題の重さの決め方の単体テスト。
import { describe, expect, it } from "vitest";
import type { ProblemKind } from "../core";
import { LEVEL_LABEL, LEVEL_MARK, levelRows, problemLevel } from "./notice-levels";

const KINDS: ProblemKind[] = [
  { code: "trace.verify", label: "トレースの抜け：要求を確かめる検証（verify）", default: "warning" },
  { code: "unsupported", label: "まだ扱えない書き方", default: "info" },
];

describe("problemLevel（問題の重さ）", () => {
  it.each([
    [{ pos: 0, msg: "x" }, "error"],
    [{ pos: 0, msg: "x", kind: "gap" as const }, "warning"],
    [{ pos: 0, msg: "x", kind: "unsupported" as const }, "info"],
  ])("選んだ重さが無ければ、種類の既定（%j → %s）", (p, expected) => {
    // Assert
    expect(problemLevel(p)).toBe(expected);
  });

  it("プロジェクトで選んだ重さがあれば、それを使う", () => {
    // Assert
    expect(problemLevel({ pos: 0, msg: "x", kind: "gap", level: "error" })).toBe("error");
    expect(problemLevel({ pos: 0, msg: "x", kind: "unsupported", level: "warning" })).toBe("warning");
  });
});

describe("LEVEL_LABEL・LEVEL_MARK（画面の言葉）", () => {
  it("重さの名前と印", () => {
    // Assert
    expect(LEVEL_LABEL).toEqual({ error: "エラー", warning: "警告", info: "情報", off: "出さない" });
    expect(LEVEL_MARK).toEqual({ error: "⚠", warning: "△", info: "ℹ" });
  });
});

describe("levelRows（重さを選ぶ画面の行）", () => {
  it("モデルの知らせの種類、続けてプラグインごとのルールを並べ、選んだ重さを入れる（正常系）", () => {
    // Act
    const rows = levelRows(KINDS, [{ plugin: "jp.x", name: "チェック", rules: ["r1", "r2"] }], { unsupported: "off", "jp.x/r2": "error" });
    // Assert
    expect(rows).toEqual([
      { kind: "trace.verify", label: "トレースの抜け：要求を確かめる検証（verify）", defaultLabel: "既定（警告）", value: null },
      { kind: "unsupported", label: "まだ扱えない書き方", defaultLabel: "既定（情報）", value: "off" },
      { kind: "jp.x/r1", label: "チェックルール：チェック／r1", defaultLabel: "既定（ルールに書いた重さ）", value: null },
      { kind: "jp.x/r2", label: "チェックルール：チェック／r2", defaultLabel: "既定（ルールに書いた重さ）", value: "error" },
    ]);
  });

  it("設定に書いてあるが読み込んでいないルールも、最後に並べる（消せるように）", () => {
    // Act
    const rows = levelRows([], [], { "jp.gone/r9": "off" });
    // Assert
    expect(rows).toEqual([{ kind: "jp.gone/r9", label: "チェックルール：jp.gone/r9（読み込んでいません）", defaultLabel: "既定（ルールに書いた重さ）", value: "off" }]);
  });

  it("種類もルールも無ければ空（境界値）", () => {
    // Assert
    expect(levelRows([], [], {})).toEqual([]);
  });
});
