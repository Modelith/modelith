// シーケンス図（SequenceView、9.2.20.2.7・8.2.3.9）の中身と、その描き方。ライフライン・イベントのキーと線の ID は、Rust のコアが決めたものを使う（ADR-0016）。
import { describe, expect, it } from "vitest";
import { build, parse, type Model, type ModelNode } from "../core";
import { drawioEventCell } from "./export";
import { eventName, seqContentOf } from "./sequence";
import { CV, seqGeom, seqMarkup, seqRowY } from "./svg";

const TEXT =
  "package P { occurrence def S { part a { event occurrence e1; then event occurrence e2; part sub { event occurrence d; } } " +
  "part b { event occurrence r; event occurrence r2; } message m1 of Go from a.e1 to b.r; message m2 from b to a.sub.d; succession s first a.e2 then b.r2; } }";

/**
 * テキストからモデルと、シーケンス図の対象を作る。
 *
 * @param text SysML v2 のテキスト
 * @param ctx 対象のシナリオの名前
 * @returns モデルと対象のノード
 */
function setup(text: string, ctx: string): { M: Model; c: ModelNode } {
  const M = build(parse(text));
  const c = M.nodes.find((n) => n.key === ctx);
  if (!c) throw new Error(`${ctx} がありません`);
  return { M, c };
}

describe("seqContentOf（シーケンス図の中身）", () => {
  it("ライフライン・段の順のメッセージ・イベントの間の順序の線と、イベントを作る", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    // Act
    const content = seqContentOf(M, c);
    // Assert
    expect(content.nodes.map((n) => [n.key, n.kind, n.lifeline])).toEqual([["l:a", "part", true], ["l:b", "part", true]]);
    expect(content.edges.map((e) => [e.id, e.kind, e.idx ?? null, e.row ?? null, e.from, e.to, e.label])).toEqual([
      ["msg|0|m1", "message", 0, 0, "l:a", "l:b", "m1"],
      ["msg|1|m2", "message", 1, 3, "l:b", "l:a", "m2"],
      ["succession|e:a.e2|e:b.r2|s#1", "succession", null, null, "e:a.e2", "e:b.r2", "s"],
    ]);
    // e2 は then で m1 の後、r2 は順序 s で e2 の後。メッセージの端でないイベントは 1 段ずつ使う
    expect(content.events.map((e) => [e.key, e.label, e.row])).toEqual([
      ["e:a.e1", ".e1", 0], ["e:b.r", ".r", 0], ["e:a.e2", ".e2", 1], ["e:b.r2", ".r2", 2], ["e:a.sub.d", ".sub.d", 3],
    ]);
    expect(content.rows).toBe(4);
  });

  it("シーケンス図の無い要素なら空（境界値）", () => {
    // Arrange
    const { M, c } = setup("package P { part def A; }", "A");
    // Act
    const content = seqContentOf(M, c);
    // Assert
    expect(content).toEqual({ nodes: [], edges: [], events: [], rows: 0 });
  });

  it("イベントの名前は、ライフラインの名前と札をつなぐ。イベントでなければ null", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    const { events, nodes } = seqContentOf(M, c);
    // Act
    const names = [eventName(events, nodes, "e:a.sub.d"), eventName(events, nodes, "l:a")];
    // Assert
    expect(names).toEqual(["a.sub.d", null]);
  });
});

describe("seqMarkup・seqGeom（シーケンス図の記法、8.2.3.9）", () => {
  it("段の数だけライフラインを伸ばす（メッセージの端でないイベントも 1 段使う）", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    const content = { ...seqContentOf(M, c), seq: true, ctx: c };
    // Act
    const g = seqGeom(content);
    // Assert
    expect(g.H).toBe(seqRowY(4) + 20);
  });

  it("イベントは白抜きの丸と札、順序は破線と開いた矢印、メッセージは段の位置の実線と塗った矢印", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    const content = { ...seqContentOf(M, c), seq: true, ctx: c };
    // Act
    const { s } = seqMarkup(CV, content);
    // Assert
    expect(s).toMatch(/<g class="event" data-key="e:a\.sub\.d" pointer-events="none"><circle cx="85" cy="248" r="5" [^>]*\/><text [^>]*>\.sub\.d<\/text><\/g>/);
    expect(s).toMatch(/data-edge="succession\|e:a\.e2\|e:b\.r2\|s#1"><path class="line" d="M[^"]+" [^>]*stroke-dasharray="6 4" marker-end="url\(#mOpen\)"\/>/);
    // 送り手の端（b）はイベントが無いのでライフラインの線から、受け手の端（a.sub.d）は丸の縁まで
    expect(s).toMatch(/data-edge="msg\|1\|m2"><path class="line" d="M285,248 L91,248"[^>]*marker-end="url\(#mMsg\)"/);
    expect(s).toContain(">1. m1 : Go</text>");
  });

  it("イベントの無いメッセージの端は、これまでどおりライフラインの線まで引く（境界値）", () => {
    // Arrange
    const { M, c } = setup("package P { occurrence def S { part a; part b; message m from a to b; } }", "S");
    const content = { ...seqContentOf(M, c), seq: true, ctx: c };
    // Act
    const { s } = seqMarkup(CV, content);
    // Assert
    expect(s).toContain('d="M85,86 L283,86"');
    expect(s).not.toContain('class="event"');
  });
});

describe("drawioEventCell（F-EXP-2、8.2.3.9 の sq-proxy）", () => {
  it("イベントは、ライフラインの線の上の段の位置に置く白抜きの小さな丸にする", () => {
    // Arrange
    const ev = { key: "e:b.r", lifeline: "l:b", label: ".r", entry: null, row: 2 };
    // Act
    const cell = drawioEventCell(ev, 1);
    // Assert
    expect(cell).toMatchObject({ x: 280, y: seqRowY(2) - 5 });
    expect(cell.style).toMatch(/^ellipse;html=1;fillColor=#FFFFFF;/);
  });
});
