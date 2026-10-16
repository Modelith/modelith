// 画面とコア（Worker）のやり取り（ADR-0016 §4）。Worker の代わりに、同じ処理（handle）を同じスレッドで動かし、
// 返事を届ける順番をテストで決める。
import { describe, expect, it } from "vitest";
import { CoreClient, STALE_EDIT, type CorePort } from "./client";
import { handle, type CoreFns, type CoreRequest, type CoreResponse, type CoreState } from "./protocol";
import { applyTextEdits } from "./text-ops";
import { analyze, edit } from "./wasm/modelith_core.js";
import type { Model, ParseResult } from "./types";

/** 返事をためておき、deliver() で届ける偽の Worker。 */
function fakeWorker(fns: CoreFns = { analyze, edit }) {
  const state: CoreState = { text: "" };
  const queue: CoreResponse[] = [];
  let listener: (r: CoreResponse) => void = () => {};
  const port: CorePort = {
    post: (req: CoreRequest) => {
      if (req.type !== "init") queue.push(handle(state, req, fns));
    },
    listen: (fn) => {
      listener = fn;
    },
  };
  const deliver = (): void => {
    for (const r of queue.splice(0)) listener(r);
  };
  return { port, deliver };
}

function client(fns?: CoreFns) {
  const w = fakeWorker(fns);
  const got: { version: number; P: ParseResult; M: Model }[] = [];
  const c = new CoreClient(w.port, (version, P, M) => got.push({ version, P, M }));
  return { c, got, deliver: w.deliver };
}

describe("CoreClient（版つきのやり取り）", () => {
  it("解析結果を、解析結果とモデルのオブジェクトに戻して渡す（正常系）", () => {
    // Arrange
    const { c, got, deliver } = client();
    // Act
    const v = c.sync("package P { part def A; }");
    deliver();
    // Assert
    expect(got.map((g) => g.version)).toEqual([v]);
    expect(got[0]?.M.nodes.map((n) => n.key)).toEqual(["A"]);
    expect(got[0]?.M.nodeOf.get(got[0].P.entries[1]!)?.key).toBe("A");
  });

  it("同じテキストは送り直さない（境界値）", () => {
    // Arrange
    const { c } = client();
    // Act
    const a = c.sync("x");
    const b = c.sync("x");
    // Assert
    expect([a, b]).toEqual([1, 1]);
  });

  it("古い版の解析結果は捨て、今の版の結果だけを渡す", () => {
    // Arrange（2 回続けて変え、返事がまとめて届く）
    const { c, got, deliver } = client();
    c.sync("package P { part def A; }");
    const latest = c.sync("package P { part def B; }");
    // Act
    deliver();
    // Assert
    expect(got.map((g) => g.version)).toEqual([latest]);
    expect(got[0]?.M.nodes.map((n) => n.key)).toEqual(["B"]);
  });

  it("編集は、送ったテキストに対して計算した結果を返す（正常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    const text = "package P { part def A; }";
    // Act
    const pending = c.edit(text, { op: "rename", key: "A", name: "B" });
    deliver();
    const r = await pending;
    // Assert
    if ("refused" in r) throw new Error(r.refused);
    expect(applyTextEdits(text, r.edits)).toBe("package P { part def B; }");
  });

  it("返事が届く前にテキストが変わったら、その編集は使わない（異常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    const pending = c.edit("package P { part def A; }", { op: "rename", key: "A", name: "B" });
    // Act（利用者が先に入力した）
    c.sync("package P { part def A; part def C; }");
    deliver();
    // Assert
    expect(await pending).toEqual({ refused: STALE_EDIT });
  });

  it("Q-5: コアが壊れた返事をしても例外を投げない（異常系）", async () => {
    // Arrange
    const { c, got, deliver } = client({ analyze: () => "{", edit: () => "{" });
    // Act
    c.sync("package P;");
    const pending = c.edit("package P;", { op: "delete", keys: [] });
    deliver();
    // Assert
    expect(got[0]?.P.errors[0]?.msg).toMatch(/^テキストを読み取れませんでした/);
    expect(await pending).toEqual({ refused: expect.stringMatching(/^操作できませんでした/) as unknown });
  });
});
