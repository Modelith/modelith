// 画面とコア（Worker）のやり取り（ADR-0016 §4）。Worker の代わりに、同じ処理（handle）を同じスレッドで動かし、
// 返事を届ける順番をテストで決める。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreClient, CORE_STOPPED, STALE_EDIT, type CorePort } from "./client";
import { failedReply, handle, type CoreFns, type CoreRequest, type CoreResponse, type CoreState } from "./protocol";
import { applyTextEdits } from "./text";
import {
  analyze, checkPluginMessage, clearProjectFiles, createProjectFile, describePlugin, edit, modelSnapshot, parseProjectFile, removeProjectFile, RulePlugins, setFocusFile, setProjectFile,
  updateProjectPlugin,
} from "./wasm/modelith_core.js";
import type { PluginFiles, RuleFinding } from "./rust";
import type { Model, ParseResult } from "./types";

/** 返事をためておき、deliver() で届ける偽の Worker。 */
const wasm: CoreFns = {
  analyze, edit, parseProjectFile, createProjectFile, updateProjectPlugin, describePlugin, loadPlugins: (json) => new RulePlugins(json), modelSnapshot, checkPluginMessage,
  setProjectFile, removeProjectFile, clearProjectFiles, setFocusFile,
};
/** コアがどの依頼にも壊れた JSON を返す（Q-5 の異常系）。 */
const broken: CoreFns = {
  analyze: () => "{",
  edit: () => "{",
  parseProjectFile: () => "{",
  createProjectFile: () => "{",
  updateProjectPlugin: () => "{",
  describePlugin: () => "{",
  loadPlugins: () => ({ summary: () => "{", analyze: () => "{", free: () => {} }),
  modelSnapshot: () => "{",
  checkPluginMessage: () => "{",
  setProjectFile: () => {},
  removeProjectFile: () => {},
  clearProjectFiles: () => {},
  setFocusFile: () => {},
};

function fakeWorker(fns: CoreFns = wasm) {
  const state: CoreState = { text: "", plugins: null };
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
  const got: { version: number; P: ParseResult; M: Model; findings: RuleFinding[] }[] = [];
  const c = new CoreClient(w.port, (version, P, M, findings) => got.push({ version, P, M, findings }));
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
    expect(got[0]?.P.errors[0]?.msg).toMatch(/^テキストを解析できませんでした/);
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
    expect(r.problems).toEqual([{ severity: "error", line: 2, column: 11, message: expect.stringMatching(/^書式にエラーがあるため読み込めません/) as unknown }]);
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
    const pending = c.createProjectFile("給水システム");
    deliver();
    const r = await pending;
    // Assert
    expect(r).toEqual({ text: '{\n  "name": "給水システム",\n  "plugins": {}\n}\n' });
  });

  it("Q-5: コアが壊れた返事をしても、設定ファイルの依頼は例外を投げない（異常系）", async () => {
    // Arrange
    const { c, deliver } = client(broken);
    // Act
    const parsed = c.parseProjectFile("{}");
    const created = c.createProjectFile("A");
    deliver();
    // Assert
    expect(await parsed).toEqual({ project: null, problems: [{ severity: "error", line: 1, column: 1, message: expect.stringMatching(/^設定ファイルを読み込めませんでした/) as unknown }] });
    expect(await created).toEqual({ refused: expect.stringMatching(/^プロジェクトの設定ファイルを作成できませんでした/) as unknown });
  });

  it("コアが返事の形の違う JSON を返しても、誤りとして返す（異常系）", async () => {
    // Arrange
    const { c, deliver } = client({ ...wasm, parseProjectFile: () => '{"error":"x"}', createProjectFile: () => "{}" });
    // Act
    const parsed = c.parseProjectFile("{}");
    const created = c.createProjectFile("A");
    deliver();
    // Assert
    expect((await parsed).problems[0]?.message).toBe("設定ファイルを読み込めませんでした（x）");
    expect(await created).toEqual({ refused: "プロジェクトの設定ファイルを作成できませんでした（コアの返事の形が違います）" });
  });
});

describe("failedReply（コアの中の予期しない失敗）", () => {
  it.each<[Exclude<CoreRequest, { type: "init" }>, CoreResponse["type"]]>([
    [{ type: "didChange", version: 1, text: "" }, "analyzed"],
    [{ type: "edit", version: 1, id: 2, intent: { op: "delete", keys: [] } }, "edited"],
    [{ type: "parseProject", id: 3, text: "{}" }, "projectParsed"],
    [{ type: "createProject", id: 4, name: "A" }, "projectCreated"],
    [{ type: "updateProject", id: 5, text: "{}", plugin: "jp.x", change: { op: "remove" } }, "projectUpdated"],
    [{ type: "setPlugins", id: 6, plugins: [] }, "pluginsSet"],
    [{ type: "describePlugin", id: 7, text: "{}" }, "pluginDescribed"],
  ])("%o には %s で返す", (req, type) => {
    // Arrange・Act
    const r = failedReply(req, "boom");
    // Assert（失敗の印が付く。Q-7）
    expect([r.type, "failure" in r ? r.failure : undefined]).toEqual([type, "boom"]);
  });

  it("CoreClient は、失敗の返事を読み取れない設定・断りとして受け取り、つなぎ直すまでの依頼は読み込み直し中と断る", async () => {
    // Arrange
    const fail = (): string => {
      throw new Error("boom");
    };
    const state: CoreState = { text: "", plugins: null };
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
    // Act（失敗の返事でコアは止まったと見なし、つなぎ直すまでは依頼をすぐ断る。Q-7）
    const parsed = await c.parseProjectFile("{}");
    const created = await c.createProjectFile("A");
    // Assert
    expect(parsed.problems[0]?.message).toBe("設定ファイルを読み込めませんでした（boom）");
    expect(created).toEqual({ refused: "プロジェクトの設定ファイルを作成できませんでした（図を読み込み直しています）" });
  });
});

/** チェックルールのプラグイン（要求に「満たす」関係が無ければ注意を出す）。 */
const MANIFEST = JSON.stringify({ id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", apiVersion: "0", runtime: "rules", license: "MIT", contributes: { rules: ["rules.yaml"] } });
const RULES = 'rules:\n  - id: req-sat\n    severity: warning\n    message: "要求「{name}」を満たす要素がありません"\n    match: { kind: requirement def }\n    require: { incoming: satisfy }\n';
const plugin = (files: Record<string, string> = { "modelith-plugin.json": MANIFEST, "rules.yaml": RULES }, enabled = true): PluginFiles => ({ id: "jp.x", enabled, files });

describe("CoreClient（チェックルールのプラグイン、F-PLUG-1・F-PLUG-3）", () => {
  it("F-PLUG-1: 読み込んだプラグインのルールの結果を、今のテキストの解析結果に付けて渡す（正常系）", async () => {
    // Arrange（先にテキストを送っておく）
    const { c, got, deliver } = client();
    c.sync("package P {\n    requirement def R;\n}\n");
    deliver();
    // Act
    const pending = c.setPlugins([plugin()]);
    deliver();
    const r = await pending;
    // Assert（送り直したテキストの結果に、ルールの結果が付く）
    expect(r.plugins.map((p) => [p.id, p.installed, p.manifest?.name, p.rules, p.problems.length])).toEqual([["jp.x", true, "トレーサビリティのチェック", 1, 0]]);
    expect(got.at(-1)?.findings).toEqual([{ plugin: "jp.x", rule: "req-sat", severity: "warning", message: "要求「R」を満たす要素がありません", element: "R", pos: 16 }]);
    expect(got.at(-1)?.version).toBe(c.current);
  });

  it("F-PLUG-1: 編集で直すと、ルールの結果も消える", async () => {
    // Arrange
    const { c, got, deliver } = client();
    void c.setPlugins([plugin()]);
    c.sync("package P { requirement def R; }");
    deliver();
    // Act
    c.sync("package P { requirement def R; part def A; satisfy R by A; }");
    deliver();
    // Assert
    expect(got.map((g) => g.findings.length)).toEqual([1, 0]);
  });

  it("止めたプラグインのルールは当てない（まとめには出す）", async () => {
    // Arrange
    const { c, got, deliver } = client();
    c.sync("package P { requirement def R; }");
    // Act
    const pending = c.setPlugins([plugin(undefined, false)]);
    deliver();
    // Assert
    expect((await pending).plugins[0]?.enabled).toBe(false);
    expect(got.at(-1)?.findings).toEqual([]);
  });

  it("F-PLUG-3: 読めないルールのファイルは、ファイルと行を添えてまとめに出す（異常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    // Act
    const pending = c.setPlugins([plugin({ "modelith-plugin.json": MANIFEST, "rules.yaml": "rules:\n  - id: a\n    oops: 1\n" })]);
    deliver();
    const r = await pending;
    // Assert
    expect(r.plugins[0]?.problems[0]).toMatchObject({ path: ".modelith/plugins/jp.x/rules.yaml", place: { line: 3 } });
  });

  it("F-PLUG-9: ファイルの無いプラグインは、入っていないとまとめに出す（境界値: 空のファイル）", async () => {
    // Arrange
    const { c, deliver } = client();
    // Act
    const pending = c.setPlugins([plugin({})]);
    deliver();
    // Assert
    expect((await pending).plugins[0]).toMatchObject({ installed: false, manifest: null, rules: 0 });
  });

  it("プラグインを空にすると、ルールを当てなくなる（境界値: 0 個）", async () => {
    // Arrange
    const { c, got, deliver } = client();
    void c.setPlugins([plugin()]);
    c.sync("package P { requirement def R; }");
    // Act
    const pending = c.setPlugins([]);
    deliver();
    // Assert
    expect(await pending).toEqual({ plugins: [] });
    expect(got.at(-1)?.findings).toEqual([]);
  });

  it("設定ファイルの使うプラグインを書き換え、マニフェストの名前と種類を読む（正常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    // Act
    const updated = c.updateProjectPlugin("{}", "jp.x", { op: "add", version: "0.1.0" });
    const described = c.describePlugin(MANIFEST);
    deliver();
    // Assert
    expect(await updated).toEqual({ text: '{\n  "plugins": {\n    "jp.x": {\n      "version": "0.1.0",\n      "enabled": true\n    }\n  }\n}\n' });
    expect(await described).toEqual({ plugin: { id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", runtime: "rules" } });
  });

  it("書き換えられない・読めないときは、理由の断りを返す（異常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    // Act
    const updated = c.updateProjectPlugin("{}", "jp.x", { op: "remove" });
    const described = c.describePlugin("{");
    deliver();
    // Assert
    expect(await updated).toEqual({ refused: "プロジェクトの設定（modelith.json）に、プラグイン「jp.x」がありません" });
    expect(await described).toEqual({ refused: expect.stringMatching(/^modelith-plugin\.json の 1 行目：/) as unknown });
  });

  it("Q-5: コアが壊れた返事をしても、プラグインの依頼は例外を投げない（異常系）", async () => {
    // Arrange
    const { c, deliver } = client(broken);
    // Act
    const set = c.setPlugins([plugin()]);
    const updated = c.updateProjectPlugin("{}", "jp.x", { op: "remove" });
    const described = c.describePlugin("{}");
    deliver();
    // Assert
    expect((await set).error).toMatch(/^プラグインを読み込めませんでした/);
    expect(await updated).toEqual({ refused: expect.stringMatching(/^プロジェクトの設定を変更できませんでした/) as unknown });
    expect(await described).toEqual({ refused: expect.stringMatching(/^プラグインを読み込めませんでした/) as unknown });
  });

  it("コアが返事の形の違う JSON を返しても、誤りとして返す（異常系）", async () => {
    // Arrange
    const { c, deliver } = client({ ...wasm, loadPlugins: () => ({ summary: () => '{"error":"x"}', analyze, free: () => {} }), describePlugin: () => "{}" });
    // Act
    const set = c.setPlugins([plugin()]);
    const described = c.describePlugin("{}");
    deliver();
    // Assert
    expect(await set).toEqual({ plugins: [], error: "x" });
    expect(await described).toEqual({ refused: "プラグインを読み込めませんでした（コアの返事の形が違います）" });
  });

  it("プラグインを置き換えると、前に読み込んだものを返す（free）", () => {
    // Arrange
    let freed = 0;
    const fns: CoreFns = { ...wasm, loadPlugins: () => ({ summary: () => '{"plugins":[]}', analyze, free: () => void freed++ }) };
    const state: CoreState = { text: "", plugins: null };
    handle(state, { type: "setPlugins", id: 1, plugins: [plugin()] }, fns);
    // Act
    handle(state, { type: "setPlugins", id: 2, plugins: [] }, fns);
    // Assert
    expect([freed, state.plugins]).toEqual([1, null]);
  });
});

describe("CoreClient（v1 のプラグイン、ADR-0018 §3・§4）", () => {
  const PROPOSE = JSON.stringify({ type: "proposeEdits", version: 1, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } }, newText: "library" }] });

  it("今のテキストから、プラグインに渡すモデルを版つきで返す（正常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    const version = c.sync("package P { part def A; }");
    // Act
    const pending = c.modelSnapshot();
    deliver();
    // Assert
    const got = await pending;
    expect(got?.version).toBe(version);
    expect(got?.snapshot.elements.map((e) => e.key)).toEqual(["A"]);
  });

  it("返事の前にテキストが変わったら、モデルは null にする（古い版）", async () => {
    // Arrange
    const { c, deliver } = client();
    c.sync("package P { part def A; }");
    const pending = c.modelSnapshot();
    // Act
    c.sync("package P { part def B; }");
    deliver();
    // Assert
    expect(await pending).toBeNull();
  });

  it("F-PLUG-5: 変更案を、今のテキストの位置に直して返す（正常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    const version = c.sync("package P;");
    // Act
    const pending = c.checkPluginMessage(PROPOSE, ["edits:propose"]);
    deliver();
    // Assert
    expect(await pending).toEqual({ version, stale: false, checked: { message: JSON.parse(PROPOSE) as unknown, edits: [{ start: 0, end: 7, text: "library" }] } });
  });

  it("F-PLUG-7: 宣言していない権限のメッセージは、理由を添えて断る（異常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    c.sync("package P;");
    // Act
    const pending = c.checkPluginMessage(PROPOSE, ["model:read"]);
    deliver();
    // Assert
    expect((await pending)?.checked).toEqual({ refused: "宣言していない権限（edits:propose）が要るメッセージ（proposeEdits）のため、使いませんでした" });
  });

  it("F-PLUG-5: 返事の前にテキストが変わったら、確かめた結果に古い版の印を付ける", async () => {
    // Arrange
    const { c, deliver } = client();
    const version = c.sync("package P;");
    const pending = c.checkPluginMessage(PROPOSE, ["edits:propose"]);
    // Act
    c.sync("package Q;");
    deliver();
    // Assert
    expect(await pending).toMatchObject({ version, stale: true });
  });

  it("Q-5: コアが壊れた返事をしても、例外を投げない（異常系）", async () => {
    // Arrange
    const { c, deliver } = client(broken);
    c.sync("package P;");
    // Act
    const snapshot = c.modelSnapshot();
    const checked = c.checkPluginMessage('{"type":"ready"}', []);
    deliver();
    // Assert
    expect(await snapshot).toBeNull();
    expect((await checked)?.checked).toEqual({ refused: expect.stringMatching(/^メッセージを確かめられませんでした/) as unknown });
  });

  it("コアが失敗したときも、依頼と同じ版で返事をする（failedReply）", () => {
    // Arrange
    const req: CoreRequest = { type: "checkPluginMessage", version: 5, id: 6, message: "{}", permissions: [] };
    // Act
    const res = failedReply(req as Exclude<CoreRequest, { type: "init" }>, "boom");
    // Assert
    expect(res).toEqual({ type: "pluginMessageChecked", version: 5, id: 6, json: '{"refused":"メッセージを確かめられませんでした（boom）"}', failure: "boom" });
  });
});

/** 返事をためておき、deliverAll() で届けるか、crash() でコアが落ちたと知らせる偽の Worker（Q-7 の異常系）。 */
function stallableWorker(fns: CoreFns = wasm) {
  const state: CoreState = { text: "", plugins: null };
  const queue: CoreResponse[] = [];
  const posted: CoreRequest[] = [];
  let listener: (r: CoreResponse) => void = () => {};
  let failure: (reason: string) => void = () => {};
  const port: CorePort = {
    post: (req: CoreRequest) => {
      posted.push(req);
      if (req.type === "init") return;
      try {
        queue.push(handle(state, req, fns));
      } catch (e) {
        queue.push(failedReply(req, (e as Error).message));
      }
    },
    listen: (fn) => {
      listener = fn;
    },
    listenFailure: (fn) => {
      failure = fn;
    },
  };
  return { port, posted, deliverAll: (): void => queue.splice(0).forEach((r) => listener(r)), crash: (reason: string): void => failure(reason) };
}

describe("CoreClient（コアが止まった・返事をしないときの出口、Q-7）", () => {
  const TIMEOUT = 1000;

  function supervised(fns?: CoreFns) {
    const w = stallableWorker(fns);
    const downs: string[] = [];
    const got: number[] = [];
    const c = new CoreClient(w.port, (version) => got.push(version), { timeoutMs: TIMEOUT, onDown: (reason) => downs.push(reason) });
    return { c, w, downs, got };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("期限の直前に届いた返事は使う（境界値: 期限 - 1 ms）", async () => {
    // Arrange
    const { c, w, downs } = supervised();
    const pending = c.edit("package P { part def A; }", { op: "rename", key: "A", name: "B" });
    // Act
    vi.advanceTimersByTime(TIMEOUT - 1);
    w.deliverAll();
    vi.advanceTimersByTime(1);
    // Assert
    expect("edits" in (await pending)).toBe(true);
    expect([downs, c.connected]).toEqual([[], true]);
  });

  it("期限までに返事が来なければ、待っていた図の操作をやめ、コアが止まったと知らせる（境界値: 期限ちょうど）", async () => {
    // Arrange
    const { c, w, downs } = supervised();
    const pending = c.edit("package P { part def A; }", { op: "rename", key: "A", name: "B" });
    // Act
    vi.advanceTimersByTime(TIMEOUT);
    w.deliverAll(); // 遅れて届いた返事は捨てる
    // Assert
    expect(await pending).toEqual({ refused: CORE_STOPPED });
    expect([downs, c.connected]).toEqual([["1 秒たっても返事がありません"], false]);
  });

  it("解析の返事が来なくても、期限で止まったと知らせる（編集を待っていなくても）", () => {
    // Arrange
    const { c, downs } = supervised();
    c.sync("package P;");
    // Act
    vi.advanceTimersByTime(TIMEOUT);
    // Assert
    expect(downs).toHaveLength(1);
  });

  it("Worker のエラーで、待っていた依頼をすべて失敗にする（異常系）", async () => {
    // Arrange
    const { c, w, downs } = supervised();
    const edit = c.edit("package P;", { op: "delete", keys: [] });
    const parsed = c.parseProjectFile("{}");
    const snapshot = c.modelSnapshot();
    // Act
    w.crash("boom");
    // Assert
    expect(await edit).toEqual({ refused: CORE_STOPPED });
    expect((await parsed).problems[0]?.message).toBe("設定ファイルを読み込めませんでした（boom）");
    expect(await snapshot).toBeNull();
    expect(downs).toEqual(["boom"]);
  });

  it("wasm の例外（失敗の返事）を受け取ったら、その返事は断りにし、コアが止まったと知らせる", async () => {
    // Arrange
    const fail = (): string => {
      throw new Error("panic");
    };
    const { c, w, downs } = supervised({ ...wasm, edit: fail });
    const pending = c.edit("package P;", { op: "delete", keys: [] });
    // Act
    w.deliverAll();
    // Assert
    expect(await pending).toEqual({ refused: "操作できませんでした（panic）" });
    expect(downs).toEqual(["panic"]);
  });

  it("止まった後、つなぎ直すまでの依頼はすぐ断る", async () => {
    // Arrange
    const { c, w } = supervised();
    w.crash("boom");
    // Act
    const r = await c.edit("package P;", { op: "delete", keys: [] });
    // Assert
    expect(r).toEqual({ refused: CORE_STOPPED });
  });

  it("つなぎ直すと、今のテキストとプラグインを新しいコアに送り直し、解析結果が届く（正常系）", () => {
    // Arrange
    const { c, w, got } = supervised();
    void c.setPlugins([plugin()]);
    c.sync("package P { requirement def R; }");
    w.deliverAll();
    w.crash("boom");
    const next = stallableWorker();
    // Act
    c.reconnect(next.port);
    next.deliverAll();
    // Assert
    expect(next.posted.map((r) => r.type)).toEqual(["setPlugins", "didChange"]);
    expect([c.connected, got.at(-1)]).toEqual([true, c.current]);
    expect(c.text).toBe("package P { requirement def R; }");
  });

  it("止まっている間に変えたテキストを、つなぎ直したときに送る", () => {
    // Arrange
    const { c, w } = supervised();
    c.sync("package P;");
    w.crash("boom");
    c.sync("package Q;");
    const next = stallableWorker();
    // Act
    c.reconnect(next.port);
    // Assert
    expect(next.posted).toEqual([{ type: "didChange", version: c.current, text: "package Q;", path: null }]);
  });

  it("古い通り道から遅れて届いた返事は捨てる", () => {
    // Arrange
    const { c, w, got } = supervised();
    c.sync("package P;");
    w.crash("boom");
    const next = stallableWorker();
    c.reconnect(next.port);
    // Act
    w.deliverAll();
    // Assert
    expect(got).toEqual([]);
  });
});

describe("CoreClient: プロジェクトのファイル（ADR-0021、F-FILE-15）", () => {
  // コア（wasm）が覚えるファイルはテストの間で共有されるので、毎回忘れさせる
  afterEach(() => clearProjectFiles());

  it("ほかのファイルを覚えさせると、その定義を参照する要素を描き、ファイルのパスを持つ", async () => {
    // Arrange
    const { c, got: analyzed, deliver } = client();
    c.focus("app.sysml");
    c.sync("package App { import Parts::*; part c : Car; }");
    deliver();
    // Act
    const done = c.updateFiles({ set: [{ path: "parts.sysml", text: "package Parts { part def Car; part def Bus; }" }], remove: [] });
    deliver();
    await done;
    // Assert（Bus は参照していないので描かない）
    const M = analyzed.at(-1)?.M;
    expect(M?.nodes.map((n) => [n.key, n.file])).toEqual([["c", undefined], ["Car", "parts.sysml"]]);
  });

  it("表示中のファイルと同じパスのファイルは、ほかのファイルとしてつながない（境界値）", async () => {
    // Arrange
    const { c, got: analyzed, deliver } = client();
    const done = c.updateFiles({ set: [{ path: "app.sysml", text: "package Old { part def Car; }" }], remove: [] });
    deliver();
    await done;
    // Act
    c.focus("app.sysml");
    c.sync("package App { part c : Old::Car; }");
    deliver();
    // Assert（保存前の古い中身の Car は見えない）
    expect(analyzed.at(-1)?.M.problems.map((p) => p.msg)).toEqual(["型「Old::Car」が見つかりません（c）"]);
  });

  it("ほかのファイルの要素を書き換えようとすると、そのファイルのパスを添えて断る（異常系）", async () => {
    // Arrange
    const { c, deliver } = client();
    const text = "package App { part c : Parts::Car; }";
    const done = c.updateFiles({ set: [{ path: "parts.sysml", text: "package Parts { part def Car; }" }], remove: [] });
    deliver();
    await done;
    c.focus("app.sysml");
    c.sync(text);
    deliver();
    // Act
    const edited = c.edit(text, { op: "rename", key: "Car", name: "Bus" });
    deliver();
    // Assert
    expect(await edited).toMatchObject({ file: "parts.sysml" });
  });

  it("忘れさせたファイルの定義は見つからなくなる", async () => {
    // Arrange
    const { c, got: analyzed, deliver } = client();
    c.sync("package App { part c : Parts::Car; }");
    const set = c.updateFiles({ set: [{ path: "parts.sysml", text: "package Parts { part def Car; }" }], remove: [] });
    deliver();
    await set;
    // Act
    const removed = c.updateFiles({ set: [], remove: ["parts.sysml"] });
    deliver();
    await removed;
    // Assert
    expect(analyzed.at(-1)?.M.problems.map((p) => p.msg)).toEqual(["型「Parts::Car」が見つかりません（c）"]);
  });
});
