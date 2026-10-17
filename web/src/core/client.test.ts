// 画面とコア（Worker）のやり取り（ADR-0016 §4）。Worker の代わりに、同じ処理（handle）を同じスレッドで動かし、
// 返事を届ける順番をテストで決める。
import { describe, expect, it } from "vitest";
import { CoreClient, STALE_EDIT, type CorePort } from "./client";
import { failedReply, handle, type CoreFns, type CoreRequest, type CoreResponse, type CoreState } from "./protocol";
import { applyTextEdits } from "./text-ops";
import { analyze, createProjectFile, edit, parseProjectFile } from "./wasm/modelith_core.js";
import type { Model, ParseResult } from "./types";

/** 返事をためておき、deliver() で届ける偽の Worker。 */
const wasm: CoreFns = { analyze, edit, parseProjectFile, createProjectFile };
/** コアがどの依頼にも壊れた JSON を返す（Q-5 の異常系）。 */
const broken: CoreFns = { analyze: () => "{", edit: () => "{", parseProjectFile: () => "{", createProjectFile: () => "{" };

function fakeWorker(fns: CoreFns = wasm) {
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
    const { c, got, deliver } = client(broken);
    // Act
    c.sync("package P;");
    const pending = c.edit("package P;", { op: "delete", keys: [] });
    deliver();
    // Assert
    expect(got[0]?.P.errors[0]?.msg).toMatch(/^テキストを読み取れませんでした/);
    expect(await pending).toEqual({ refused: expect.stringMatching(/^操作できませんでした/) as unknown });
  });
});

describe("CoreClient（プロジェクトの設定ファイル、F-PROJ-1）", () => {
  it("設定ファイルを読み取り、設定と問題を返す（正常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    // Act
    const pending = c.parseProjectFile('{ "name": "給水", "extra": 1 }');
    deliver();
    const r = await pending;
    // Assert
    expect(r.project?.name).toBe("給水");
    expect(r.project?.["extra"]).toBe(1);
    expect(r.problems.map((p) => [p.severity, p.line, p.column])).toEqual([["warning", 1, 17]]); // 「給水」は UTF-16 で 2 単位
  });

  it("読み取れない設定ファイルは、設定を null にして誤りの位置を返す（異常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    // Act
    const pending = c.parseProjectFile("{\n  \"name\": }");
    deliver();
    const r = await pending;
    // Assert
    expect(r.project).toBeNull();
    expect(r.problems).toEqual([{ severity: "error", line: 2, column: 11, message: expect.stringMatching(/^書き方に誤りがあるため読み取れません/) as unknown }]);
  });

  it("テキストが変わっても、設定ファイルの返事は断らない（版に関係しない）", async () => {
    // Arrange
    const { c, deliver } = client();
    const pending = c.parseProjectFile("{}");
    // Act
    c.sync("package P;");
    deliver();
    const r = await pending;
    // Assert
    expect(r).toEqual({ project: { plugins: {} }, problems: [] });
  });

  it("新しい設定ファイルのテキストを作る（正常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    // Act
    const pending = c.createProjectFile("給水");
    deliver();
    const r = await pending;
    // Assert
    expect(r).toEqual({ text: '{\n  "name": "給水",\n  "plugins": {}\n}\n' });
  });

  it("Q-5: コアが壊れた返事をしても、設定ファイルの依頼は例外を投げない（異常系）", async () => {
    // Arrange
    const { c, deliver } = client(broken);
    // Act
    const parsed = c.parseProjectFile("{}");
    const created = c.createProjectFile("A");
    deliver();
    // Assert
    expect(await parsed).toEqual({ project: null, problems: [{ severity: "error", line: 1, column: 1, message: expect.stringMatching(/^設定ファイルを読み取れませんでした/) as unknown }] });
    expect(await created).toEqual({ refused: expect.stringMatching(/^プロジェクトの設定ファイルを作れませんでした/) as unknown });
  });

  it("コアが返事の形の違う JSON を返しても、誤りとして返す（異常系）", async () => {
    // Arrange
    const { c, deliver } = client({ ...wasm, parseProjectFile: () => '{"error":"x"}', createProjectFile: () => "{}" });
    // Act
    const parsed = c.parseProjectFile("{}");
    const created = c.createProjectFile("A");
    deliver();
    // Assert
    expect((await parsed).problems[0]?.message).toBe("設定ファイルを読み取れませんでした（x）");
    expect(await created).toEqual({ refused: "プロジェクトの設定ファイルを作れませんでした（コアの返事の形が違います）" });
  });
});

describe("failedReply（コアの中の予期しない失敗）", () => {
  it.each<[Exclude<CoreRequest, { type: "init" }>, CoreResponse["type"]]>([
    [{ type: "didChange", version: 1, text: "" }, "analyzed"],
    [{ type: "edit", version: 1, id: 2, intent: { op: "delete", keys: [] } }, "edited"],
    [{ type: "parseProject", id: 3, text: "{}" }, "projectParsed"],
    [{ type: "createProject", id: 4, name: "A" }, "projectCreated"],
  ])("%o には %s で返す", (req, type) => {
    // Arrange・Act
    const r = failedReply(req, "boom");
    // Assert
    expect(r.type).toBe(type);
  });

  it("CoreClient は、失敗の返事を読み取れない設定・断りとして受け取る", async () => {
    // Arrange
    const fail = (): string => {
      throw new Error("boom");
    };
    const state: CoreState = { text: "" };
    let listener: (r: CoreResponse) => void = () => {};
    const c = new CoreClient(
      {
        post: (req) => {
          if (req.type === "init") return;
          try {
            listener(handle(state, req, { ...wasm, parseProjectFile: fail, createProjectFile: fail }));
          } catch (e) {
            listener(failedReply(req, (e as Error).message));
          }
        },
        listen: (fn) => {
          listener = fn;
        },
      },
      () => {},
    );
    // Act
    const parsed = await c.parseProjectFile("{}");
    const created = await c.createProjectFile("A");
    // Assert
    expect(parsed.problems[0]?.message).toBe("設定ファイルを読み取れませんでした（boom）");
    expect(created).toEqual({ refused: "プロジェクトの設定ファイルを作れませんでした（boom）" });
  });
});
