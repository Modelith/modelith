import { describe, expect, it } from "vitest";
import type { PluginFiles, PluginInfo, PluginSummary, ProjectFile, RuleFinding } from "../core";
import { addPrompt, diagnosticText, findingText, installFiles, isSafeName, loadProblemText, missingNotice, panelIntro, pluginNotes, pluginRows, pluginState, scriptPlugins, type PluginRow } from "./plugins";

/** 追加済みで問題の無いプラグインのまとめ。 */
const summary = (over: Partial<PluginSummary> = {}): PluginSummary => ({
  id: "jp.x",
  enabled: true,
  installed: true,
  manifest: { id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", runtime: "rules" },
  rules: 2,
  problems: [],
  ...over,
});

const PROBLEM = { path: ".modelith/plugins/jp.x/rules.yaml", place: { line: 3, column: 5 }, message: "不明な項目「x」があります（…）" };

/** 一覧の行。 */
const row = (over: Partial<PluginRow> = {}): PluginRow => ({
  id: "jp.x",
  name: "トレーサビリティのチェック",
  version: "0.1.0",
  wanted: "0.1.0",
  enabled: true,
  state: "ok",
  rules: 2,
  problems: [],
  runtime: "rules",
  permissions: [],
  commands: 0,
  ...over,
});

describe("pluginState（一覧の状態）", () => {
  it.each<[string, Parameters<typeof pluginState>, ReturnType<typeof pluginState>]>([
    ["無効（未追加でも）", [{ enabled: false }, undefined], "off"],
    ["まとめが無い（まだ読み込んでいない）", [{ enabled: true }, undefined], "missing"],
    ["未追加", [{ enabled: true }, summary({ installed: false, manifest: null })], "missing"],
    ["バージョン不一致", [{ enabled: true, version: "0.2.0" }, summary()], "version"],
    ["バージョンを書いていない（どのバージョンでもよい）", [{ enabled: true }, summary()], "ok"],
    ["読み込みの問題がある", [{ enabled: true, version: "0.1.0" }, summary({ problems: [PROBLEM] })], "error"],
    ["マニフェストが読めない（バージョンを比べられない）", [{ enabled: true, version: "0.2.0" }, summary({ manifest: null, problems: [PROBLEM] })], "error"],
    ["有効", [{ enabled: true, version: "0.1.0" }, summary()], "ok"],
  ])("%s", (_, args, expected) => {
    // Arrange・Act
    const state = pluginState(...args);
    // Assert
    expect(state).toBe(expected);
  });
});

describe("loadProblemText（F-PLUG-3）", () => {
  it("ファイルと行を添える", () => {
    // Arrange・Act
    const text = loadProblemText(PROBLEM);
    // Assert
    expect(text).toBe(".modelith/plugins/jp.x/rules.yaml の 3 行目：不明な項目「x」があります（…）");
  });

  it("位置が無ければファイルだけを添える（境界値）", () => {
    // Arrange・Act
    const text = loadProblemText({ ...PROBLEM, place: null });
    // Assert
    expect(text).toBe(".modelith/plugins/jp.x/rules.yaml：不明な項目「x」があります（…）");
  });
});

describe("pluginRows（一覧の行）", () => {
  it("modelith.json の順に、名前・バージョン・状態・ルールの数・問題を並べる", () => {
    // Arrange
    const project: ProjectFile = { plugins: { "jp.x": { version: "0.1.0", enabled: true }, "jp.y": { enabled: false } } };
    // Act
    const rows = pluginRows(project, [summary({ problems: [PROBLEM] })]);
    // Assert
    expect(rows).toEqual([
      { id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", wanted: "0.1.0", enabled: true, state: "error", rules: 2, problems: [loadProblemText(PROBLEM)], runtime: "rules", permissions: [], commands: 0 },
      { id: "jp.y", name: "jp.y", version: null, wanted: null, enabled: false, state: "off", rules: 0, problems: [], runtime: null, permissions: [], commands: 0 },
    ]);
  });

  it("プラグインが無ければ空（境界値）", () => {
    // Arrange・Act
    const rows = pluginRows({ plugins: {} }, []);
    // Assert
    expect(rows).toEqual([]);
  });
});

describe("missingNotice・pluginNotes（F-PLUG-9）", () => {
  it("未追加のプラグインは、ID を示して追加するかを尋ねる", () => {
    // Arrange・Act
    const text = missingNotice(row({ state: "missing", version: null }));
    // Assert
    expect(text).toBe("このプロジェクトで使うプラグイン「jp.x」が追加されていません。追加しますか？");
  });

  it("バージョンが違うプラグインは、両方のバージョンを示す", () => {
    // Arrange・Act
    const text = missingNotice(row({ state: "version", wanted: "0.2.0" }));
    // Assert
    expect(text).toBe("このプロジェクトはプラグイン「トレーサビリティのチェック」のバージョン 0.2.0 を使いますが、追加されているのはバージョン 0.1.0 です。バージョン 0.2.0 を追加しますか？");
  });

  it.each(["ok", "error", "off"] as const)("%s のときは案内しない", (state) => {
    // Arrange・Act
    const text = missingNotice(row({ state }));
    // Assert
    expect(text).toBeNull();
  });

  it("問題一覧には、足りないプラグイン（押すと追加）と読み込みの問題を出し、無効にしたものは出さない", () => {
    // Arrange
    const rows = [
      row({ id: "jp.m", state: "missing", problems: ["…modelith-plugin.json：…入っていません…"] }),
      row({ state: "error", problems: ["a.yaml の 3 行目：x"] }),
      row({ id: "jp.off", state: "off", enabled: false, problems: ["b.yaml：y"] }),
    ];
    // Act
    const notes = pluginNotes(rows);
    // Assert
    expect(notes).toEqual([
      { msg: "このプロジェクトで使うプラグイン「jp.m」が追加されていません。追加しますか？", add: "jp.m" },
      { msg: "プラグイン「トレーサビリティのチェック」：a.yaml の 3 行目：x" },
    ]);
  });
});

describe("findingText（F-PLUG-1）", () => {
  const finding: RuleFinding = { plugin: "jp.x", rule: "req-sat", severity: "warning", message: "要求「R」を満たす要素がありません", element: "R", pos: 0 };

  it("プラグインの名前とルールの ID を添える", () => {
    // Arrange・Act
    const text = findingText(finding, new Map([["jp.x", "トレーサビリティのチェック"]]));
    // Assert
    expect(text).toBe("要求「R」を満たす要素がありません（プラグイン「トレーサビリティのチェック」のルール req-sat）");
  });

  it("名前が分からなければ ID を添える（異常系）", () => {
    // Arrange・Act
    const text = findingText(finding, new Map());
    // Assert
    expect(text).toBe("要求「R」を満たす要素がありません（プラグイン「jp.x」のルール req-sat）");
  });
});

describe("panelIntro（プラグインの一覧の案内）", () => {
  it.each<[Parameters<typeof panelIntro>[0], number, boolean, RegExp]>([
    [{ kind: "unsupported" }, 0, false, /^このブラウザはフォルダを開けないため/],
    [{ kind: "noFolder" }, 0, false, /^プラグインは、プロジェクト（モデルのフォルダ）に追加して使います。「ファイル → フォルダを開く…」/],
    [{ kind: "folder", folderName: "water" }, 0, true, /^フォルダ「water」はまだプロジェクトではありません/],
    [{ kind: "brokenProject" }, 0, false, /^プロジェクトの設定（modelith.json）にエラーがあるため/],
    [{ kind: "project", projectName: "給水システム" }, 0, true, /^プロジェクト「給水システム」にはまだプラグインがありません/],
    [{ kind: "project", projectName: "給水システム" }, 1, true, /^プロジェクト「給水システム」に追加されているプラグインです/],
  ])("%o・%i 個 → 追加できる: %s", (place, count, canAdd, text) => {
    // Arrange・Act
    const intro = panelIntro(place, count);
    // Assert
    expect(intro.canAdd).toBe(canAdd);
    expect(intro.text).toMatch(text);
  });
});

describe("addPrompt（追加の確認、F-PLUG-8）", () => {
  const info: PluginInfo = { id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", runtime: "rules" };

  it("チェックルールのプラグインは、何を追加するか・プログラムを含まないこと・置き場所を示す", () => {
    // Arrange・Act
    const prompt = addPrompt(info, { plugins: {} }, false);
    // Assert
    expect(prompt).toEqual({
      text: "「トレーサビリティのチェック」（ID：jp.x、バージョン 0.1.0）をこのプロジェクトに追加します。チェックルールのプラグインです。モデルのルールを記述したもので、プログラムは含みません。プラグインのファイルを .modelith/plugins/jp.x/ にコピーし、プロジェクトの設定（modelith.json）に登録します。Git で共有すると、チームの全員と CI が同じプラグインを使えます。",
      confirm: "追加する",
      askName: false,
    });
  });

  it("まだプロジェクトでなければ、プロジェクトにすることを伝えて名前を尋ねる（C-6）", () => {
    // Arrange・Act
    const prompt = addPrompt(info, null, false);
    // Assert
    expect(prompt).toMatchObject({ confirm: "プロジェクトにして追加", askName: true, text: expect.stringContaining("設定ファイル modelith.json をフォルダの直下に作成します") as unknown });
  });

  it("追加済みのものを上書きすること、設定のバージョンを変更することを伝える", () => {
    // Arrange
    const project: ProjectFile = { plugins: { "jp.x": { version: "0.2.0", enabled: true } } };
    // Act
    const prompt = addPrompt({ ...info, description: "要求が満たされているかをチェックします" }, project, true);
    // Assert
    if ("refused" in prompt) throw new Error(prompt.refused);
    expect(prompt.text).toContain("説明：要求が満たされているかをチェックします");
    expect(prompt.text).toContain("追加済みのプラグインは上書きされます。");
    expect(prompt.text).toContain("プロジェクトの設定ではバージョン 0.2.0 が指定されています。追加すると、設定のバージョンを 0.1.0 に変更します。");
  });

  it("wasm-component のプラグインは、まだ追加できないと伝える（異常系）", () => {
    // Arrange・Act
    const prompt = addPrompt({ ...info, name: "解析", runtime: "wasm-component" }, { plugins: {} }, false);
    // Assert
    expect(prompt).toEqual({ refused: "「解析」は、WebAssembly で動くプラグインです。この種類はまだ追加できません。現在追加できるのは、チェックルールのプラグインと、画面に機能を追加するプラグイン（TypeScript）です" });
  });

  it("F-PLUG-6: 画面に機能を追加するプラグインは、プログラムを含むことと使う権限を示す", () => {
    // Arrange
    const script: PluginInfo = { id: "jp.example.fill", name: "要求の ID の補完", version: "1.0.0", runtime: "browser", permissions: ["model:read", "edits:propose"] };
    // Act
    const prompt = addPrompt(script, { plugins: {} }, false);
    // Assert
    expect(prompt).toEqual({
      text: "「要求の ID の補完」（ID：jp.example.fill、バージョン 1.0.0）をこのプロジェクトに追加します。画面に機能を追加するプラグイン（TypeScript）です。プログラムを含み、下の権限を使います。初めて実行する前に、実行してよいかを確認します。プラグインのファイルを .modelith/plugins/jp.example.fill/ にコピーし、プロジェクトの設定（modelith.json）に登録します。Git で共有すると、チームの全員が同じプラグインを使えます。",
      confirm: "追加する",
      askName: false,
      items: ["解析したモデル（要素と関係）を受け取り、問題一覧に結果を出す（model:read）", "モデルのテキストを変更する（変更は元に戻せます）（edits:propose）"],
    });
  });

  it("F-PLUG-6: 外部と通信できるプラグインは、モデルを外部に送信できることを示す", () => {
    // Arrange
    const script: PluginInfo = { id: "jp.example.sync", name: "要求の同期", version: "1.0.0", runtime: "browser", permissions: ["network"] };
    // Act
    const prompt = addPrompt(script, { plugins: {} }, false);
    // Assert
    expect(prompt).toMatchObject({ warning: "このプラグインは、あなたのモデルを外部に送信できます。提供元を信頼できる場合だけ許可してください。" });
  });

  it("権限を宣言していないプラグインは、追加の権限が無いことを示す（境界値: 0 個）", () => {
    // Arrange
    const script: PluginInfo = { id: "jp.example.hello", name: "あいさつ", version: "1.0.0", runtime: "browser" };
    // Act
    const prompt = addPrompt(script, { plugins: {} }, false);
    // Assert
    expect(prompt).toMatchObject({ items: ["追加の権限はありません"] });
    expect(prompt).not.toHaveProperty("warning");
  });
});

describe("scriptPlugins（動かす v1 のプラグイン、ADR-0018 §3）", () => {
  const browser = (over: Partial<PluginSummary> = {}): PluginSummary =>
    summary({ id: "jp.y", manifest: { id: "jp.y", name: "要求の ID の補完", version: "1.0.0", runtime: "browser", main: "main.js", permissions: ["edits:propose"], commands: [{ id: "fill", title: "要求に ID を付ける" }] }, rules: 0, ...over });
  const files: PluginFiles[] = [{ id: "jp.y", enabled: true, files: { "modelith-plugin.json": "{}", "main.js": "/* code */" } }];

  it("有効で問題の無い v1 のプラグインを、プログラムと設定を添えて返す（正常系）", () => {
    // Arrange
    const project: ProjectFile = { plugins: { "jp.y": { enabled: true, settings: { prefix: "REQ" } } } };
    // Act
    const got = scriptPlugins(project, [browser()], files);
    // Assert
    expect(got).toEqual([
      { id: "jp.y", name: "要求の ID の補完", version: "1.0.0", permissions: ["edits:propose"], commands: [{ id: "fill", title: "要求に ID を付ける" }], code: "/* code */", settings: { prefix: "REQ" } },
    ]);
  });

  it.each<[string, ProjectFile | null, PluginSummary[], typeof files]>([
    ["無効", { plugins: { "jp.y": { enabled: false } } }, [browser()], files],
    ["読み込みの問題がある", { plugins: { "jp.y": { enabled: true } } }, [browser({ problems: [PROBLEM] })], files],
    ["チェックルールのプラグイン", { plugins: { "jp.x": { enabled: true } } }, [summary()], files],
    ["プログラムのファイルが無い", { plugins: { "jp.y": { enabled: true } } }, [browser()], [{ id: "jp.y", enabled: true, files: {} }]],
    ["プロジェクトが無い", null, [browser()], files],
  ])("%s なら動かさない（異常系）", (_, project, summaries, f) => {
    // Arrange・Act
    const got = scriptPlugins(project, summaries, f);
    // Assert
    expect(got).toEqual([]);
  });
});

describe("diagnosticText（v1 のプラグインの診断）", () => {
  it.each([
    [{ pos: 0, end: 1, severity: "warning" as const, message: "要求「R」に ID がありません", code: "req-id" }, "要求の ID の補完", "要求「R」に ID がありません（プラグイン「要求の ID の補完」の req-id）"],
    [{ pos: 0, end: 1, severity: "error" as const, message: "m" }, "jp.y", "m（プラグイン「jp.y」）"],
  ])("%o → プラグインの名前（と code）を添える", (d, name, text) => {
    // Arrange・Act
    const got = diagnosticText(d, name);
    // Assert
    expect(got).toBe(text);
  });
});

describe("installFiles（プロジェクトにコピーする計画）", () => {
  it("プラグインのフォルダの中のファイルを、.modelith/plugins/<ID>/ の下に置く", () => {
    // Arrange
    const files = { "modelith-plugin.json": "{}", "rules/a.yaml": "rules: []" };
    // Act
    const plan = installFiles("jp.x", files);
    // Assert
    expect(plan).toEqual({ files: [[".modelith/plugins/jp.x/modelith-plugin.json", "{}"], [".modelith/plugins/jp.x/rules/a.yaml", "rules: []"]] });
  });

  it.each([
    [{ "modelith-plugin.json": "{}", "../a.yaml": "x" }, "プラグインのファイル「../a.yaml」は、プラグインのフォルダの外を指しています"],
    [{ "modelith-plugin.json": "{}", "a//b.yaml": "x" }, "プラグインのファイル「a//b.yaml」は、プラグインのフォルダの外を指しています"],
    [{ "rules.yaml": "x" }, "プラグインのフォルダに modelith-plugin.json がありません"],
    [{}, "プラグインのフォルダに modelith-plugin.json がありません"],
  ])("%o は写さない（異常系）", (files, refused) => {
    // Arrange・Act
    const plan = installFiles("jp.x", files);
    // Assert
    expect(plan).toEqual({ refused });
  });

  it("ID がフォルダの名前にできなければ写さない（異常系）", () => {
    // Arrange・Act
    const plan = installFiles("..", { "modelith-plugin.json": "{}" });
    // Assert
    expect(plan).toEqual({ refused: "プラグインのファイル「modelith-plugin.json」は、プラグインのフォルダの外を指しています" });
  });
});

describe("isSafeName", () => {
  it.each([
    ["jp.example.rules", true],
    ["a", true],
    ["", false],
    [".", false],
    ["..", false],
    ["a/b", false],
    ["a\\b", false],
    ["C:", false],
  ])("%j → %s", (name, ok) => {
    // Arrange・Act
    const got = isSafeName(name);
    // Assert
    expect(got).toBe(ok);
  });
});
