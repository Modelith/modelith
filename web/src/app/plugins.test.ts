import { describe, expect, it } from "vitest";
import type { PluginFiles, PluginInfo, PluginSummary, ProjectFile, RuleFinding } from "../core";
import type { BrowserPlugin } from "../plugins/browser-store";
import {
  addPrompt, browserPluginFiles, browserProblem, browserRows, browserScriptPlugins, diagnosticText, findingText, installFiles, isSafeName, isShadowed, loadProblemText, missingNotice, panelIntro,
  pluginFolderPath, pluginNotes, pluginRows, pluginState, projectBlocked, removePrompt, scriptPlugins, type AddTarget, type PluginRow,
} from "./plugins";

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
  place: "project",
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
      { id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", wanted: "0.1.0", enabled: true, state: "error", rules: 2, problems: [loadProblemText(PROBLEM)], runtime: "rules", permissions: [], commands: 0, place: "project" },
      { id: "jp.y", name: "jp.y", version: null, wanted: null, enabled: false, state: "off", rules: 0, problems: [], runtime: null, permissions: [], commands: 0, place: "project" },
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

describe("panelIntro・projectBlocked（プラグインの一覧の案内と、このプロジェクトに追加できるか、F-PLUG-8）", () => {
  it.each<[Parameters<typeof panelIntro>[0], number, RegExp, string | null]>([
    [{ kind: "unsupported" }, 0, /^このブラウザはフォルダを開けないため、プラグインはこのブラウザにだけ追加できます/, "このブラウザはフォルダを開けないため選べません"],
    [{ kind: "noFolder" }, 0, /^フォルダを開いていないため、プラグインはこのブラウザにだけ追加できます/, "フォルダを開いていないため選べません。「ファイル → フォルダを開く…」で開けます"],
    [{ kind: "folder", folderName: "water" }, 0, /^フォルダ「water」はまだプロジェクトではありません/, null],
    [{ kind: "brokenProject" }, 0, /このブラウザへの追加はできます。$/, "プロジェクトの設定（modelith.json）にエラーがあるため選べません"],
    [{ kind: "project", projectName: "給水システム" }, 0, /^プロジェクト「給水システム」にはまだプラグインがありません/, null],
    [{ kind: "project", projectName: "給水システム" }, 1, /^プロジェクト「給水システム」に追加されているプラグインです/, null],
  ])("%o・%i 個", (place, count, text, blocked) => {
    // Arrange・Act
    const intro = panelIntro(place, count);
    const reason = projectBlocked(place);
    // Assert
    expect(intro).toMatch(text);
    expect(reason).toBe(blocked);
  });
});

describe("addPrompt（追加の確認と追加先、F-PLUG-8）", () => {
  const info: PluginInfo = { id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", runtime: "rules" };
  /** プロジェクトを開いていて、どちらにも追加されていない状態。 */
  const target = (over: Partial<AddTarget> = {}): AddTarget => ({ project: { plugins: {} }, blocked: null, inProject: false, inBrowser: false, ...over });

  it("チェックルールのプラグインは、何を追加するか・プログラムを含まないことと、2 つの追加先を示す（既定はこのプロジェクト）", () => {
    // Arrange・Act
    const prompt = addPrompt(info, target());
    // Assert
    expect(prompt).toEqual({
      text: "「トレーサビリティのチェック」（ID：jp.x、バージョン 0.1.0）を追加します。チェックルールのプラグインです。モデルのルールを記述したもので、プログラムは含みません。",
      initial: "project",
      places: [
        { id: "project", label: "このプロジェクト", note: ".modelith/plugins/jp.x/ にコピーし、プロジェクトの設定（modelith.json）に登録します。Git で共有すると、チームの全員と CI が同じプラグインを使えます。", disabled: false, confirm: "追加する", askName: false },
        { id: "browser", label: "このブラウザ", note: "このブラウザだけに保存します。どのプロジェクトでも、フォルダを開かなくても使えます。ほかの人や CI（modelith check）とは共有されません。", disabled: false, confirm: "追加する", askName: false },
      ],
    });
  });

  it("まだプロジェクトでなければ、このプロジェクトを選んだときにプロジェクトにすることを伝えて名前を尋ねる（C-6）", () => {
    // Arrange・Act
    const prompt = addPrompt(info, target({ project: null }));
    // Assert
    if ("refused" in prompt) throw new Error(prompt.refused);
    expect(prompt.places[0]).toMatchObject({ confirm: "プロジェクトにして追加", askName: true, note: expect.stringContaining("設定ファイル modelith.json をフォルダの直下に作成します") as unknown });
    expect(prompt.places[1]).toMatchObject({ confirm: "追加する", askName: false });
  });

  it("このプロジェクトに追加できない場面では、理由を示して選べなくし、このブラウザを選んでおく", () => {
    // Arrange・Act
    const prompt = addPrompt(info, target({ project: null, blocked: "フォルダを開いていないため選べません。「ファイル → フォルダを開く…」で開けます" }));
    // Assert
    if ("refused" in prompt) throw new Error(prompt.refused);
    expect(prompt.initial).toBe("browser");
    expect(prompt.places[0]).toEqual({ id: "project", label: "このプロジェクト", note: "フォルダを開いていないため選べません。「ファイル → フォルダを開く…」で開けます", disabled: true, confirm: "追加する", askName: false });
  });

  it("追加済みのものを上書きすること、設定のバージョンを変更すること、プロジェクトのものが優先されることを、追加先ごとに伝える", () => {
    // Arrange
    const project: ProjectFile = { plugins: { "jp.x": { version: "0.2.0", enabled: true } } };
    // Act
    const prompt = addPrompt({ ...info, description: "要求が満たされているかをチェックします" }, target({ project, inProject: true, inBrowser: true }));
    // Assert
    if ("refused" in prompt) throw new Error(prompt.refused);
    expect(prompt.text).toContain("説明：要求が満たされているかをチェックします");
    expect(prompt.places[0]?.note).toContain("追加済みのプラグインは上書きされます。プロジェクトの設定ではバージョン 0.2.0 が指定されています。追加すると、設定のバージョンを 0.1.0 に変更します。");
    expect(prompt.places[1]?.note).toContain("このブラウザに追加済みのプラグインは上書きされます。このプロジェクトには同じ ID のプラグインがあるため、このプロジェクトではプロジェクトのものを使います。");
  });

  it("wasm-component のプラグインは、まだ追加できないと伝える（異常系）", () => {
    // Arrange・Act
    const prompt = addPrompt({ ...info, name: "解析", runtime: "wasm-component" }, target());
    // Assert
    expect(prompt).toEqual({ refused: "「解析」は、WebAssembly で動くプラグインです。この種類はまだ追加できません。現在追加できるのは、チェックルールのプラグインと、画面に機能を追加するプラグイン（TypeScript）です" });
  });

  it("F-PLUG-6: 画面に機能を追加するプラグインは、プログラムを含むことと使う権限を示す（CLI では動かないので CI の共有は書かない）", () => {
    // Arrange
    const script: PluginInfo = { id: "jp.example.fill", name: "要求の ID の補完", version: "1.0.0", runtime: "browser", permissions: ["model:read", "edits:propose"] };
    // Act
    const prompt = addPrompt(script, target());
    // Assert
    if ("refused" in prompt) throw new Error(prompt.refused);
    expect(prompt.text).toBe("「要求の ID の補完」（ID：jp.example.fill、バージョン 1.0.0）を追加します。画面に機能を追加するプラグイン（TypeScript）です。プログラムを含み、下の権限を使います。初めて実行する前に、実行してよいかを確認します。");
    expect(prompt.items).toEqual(["解析したモデル（要素と関係）を受け取り、問題一覧に結果を出す（model:read）", "モデルのテキストを変更する（変更は元に戻せます）（edits:propose）"]);
    expect(prompt.places.map((p) => p.note)).toEqual([
      ".modelith/plugins/jp.example.fill/ にコピーし、プロジェクトの設定（modelith.json）に登録します。Git で共有すると、チームの全員が同じプラグインを使えます。",
      "このブラウザだけに保存します。どのプロジェクトでも、フォルダを開かなくても使えます。ほかの人とは共有されません。",
    ]);
  });

  it("F-PLUG-6: 外部と通信できるプラグインは、モデルを外部に送信できることを示す", () => {
    // Arrange
    const script: PluginInfo = { id: "jp.example.sync", name: "要求の同期", version: "1.0.0", runtime: "browser", permissions: ["network"] };
    // Act
    const prompt = addPrompt(script, target());
    // Assert
    expect(prompt).toMatchObject({ warning: "このプラグインは、あなたのモデルを外部に送信できます。提供元を信頼できる場合だけ許可してください。" });
  });

  it("権限を宣言していないプラグインは、追加の権限が無いことを示す（境界値: 0 個）", () => {
    // Arrange
    const script: PluginInfo = { id: "jp.example.hello", name: "あいさつ", version: "1.0.0", runtime: "browser" };
    // Act
    const prompt = addPrompt(script, target());
    // Assert
    expect(prompt).toMatchObject({ items: ["追加の権限はありません"] });
    expect(prompt).not.toHaveProperty("warning");
  });
});

describe("このブラウザに追加したプラグイン（F-PLUG-8、ADR-0018 §1）", () => {
  const scriptInfo: PluginInfo = { id: "jp.y", name: "レビューの記録", version: "1.0.0", runtime: "browser", main: "main.js", permissions: ["storage"], importers: [{ id: "csv", label: "表", extensions: [".csv"] }] };
  /** このブラウザに追加したプラグイン。 */
  const added = (over: Partial<BrowserPlugin> = {}): BrowserPlugin => ({ id: "jp.y", enabled: true, info: scriptInfo, files: { "modelith-plugin.json": "{}", "main.js": "/* code */" }, ...over });
  const summaryOfY = summary({ id: "jp.y", manifest: scriptInfo, rules: 0 });

  it.each<[string, ProjectFile | null, boolean]>([
    ["modelith.json に同じ ID がある", { plugins: { "jp.y": { enabled: true } } }, true],
    ["modelith.json で同じ ID を無効にしていても、プロジェクトが決める", { plugins: { "jp.y": { enabled: false } } }, true],
    ["modelith.json に無い", { plugins: { "jp.x": { enabled: true } } }, false],
    ["プロジェクトが無い", null, false],
  ])("isShadowed：%s → %s", (_, project, expected) => {
    // Arrange・Act
    const got = isShadowed("jp.y", project);
    // Assert
    expect(got).toBe(expected);
  });

  it("一覧の行は、ID の順に、入れた先をこのブラウザにして作る", () => {
    // Arrange
    const plugins = [added({ id: "jp.z", info: { ...scriptInfo, id: "jp.z", name: "z" } }), added()];
    // Act
    const rows = browserRows(plugins, null, [summaryOfY]);
    // Assert
    expect(rows.map((r) => [r.id, r.place, r.state])).toEqual([
      ["jp.y", "browser", "ok"],
      ["jp.z", "browser", "ok"],
    ]);
    expect(rows[0]).toMatchObject({ name: "レビューの記録", version: "1.0.0", wanted: null, runtime: "browser", permissions: ["storage"] });
  });

  it("同じ ID のプロジェクトのプラグインがあれば「プロジェクトを優先」にし、コアにも渡さず、動かさない", () => {
    // Arrange
    const project: ProjectFile = { plugins: { "jp.y": { enabled: true } } };
    // Act
    const rows = browserRows([added()], project, [summaryOfY]);
    const files = browserPluginFiles([added()], project);
    const scripts = browserScriptPlugins([added()], project, [summaryOfY]);
    // Assert
    expect(rows[0]?.state).toBe("shadowed");
    expect(files).toEqual([]);
    expect(scripts).toEqual([]);
  });

  it("無効にしたもの・読み込みの問題があるものの状態（問題のパスはこのブラウザのものとして示す）", () => {
    // Arrange
    const problem = { path: ".modelith/plugins/jp.y/rules.yaml", place: { line: 2, column: 1 }, message: "m" };
    // Act
    const off = browserRows([added({ enabled: false })], null, [summaryOfY]);
    const broken = browserRows([added()], null, [summary({ id: "jp.y", manifest: scriptInfo, problems: [problem] })]);
    // Assert
    expect(off[0]?.state).toBe("off");
    expect(broken[0]).toMatchObject({ state: "error", problems: ["このブラウザの jp.y/rules.yaml の 2 行目：m"] });
  });

  it("コアに渡すファイルと、動かすプラグイン（取り込みを含む）を選ぶ（正常系）", () => {
    // Arrange・Act
    const files = browserPluginFiles([added()], null);
    const scripts = browserScriptPlugins([added()], null, [summaryOfY]);
    // Assert
    expect(files).toEqual([{ id: "jp.y", enabled: true, files: added().files }]);
    expect(scripts).toEqual([{ id: "jp.y", name: "レビューの記録", version: "1.0.0", permissions: ["storage"], commands: [], importers: [{ id: "csv", label: "表", extensions: [".csv"] }], exporters: [], code: "/* code */" }]);
  });

  it.each<[string, BrowserPlugin, PluginSummary[]]>([
    ["無効", added({ enabled: false }), [summaryOfY]],
    ["読み込みの問題がある", added(), [summary({ id: "jp.y", manifest: scriptInfo, problems: [PROBLEM] })]],
    ["プログラムのファイルが無い", added({ files: { "modelith-plugin.json": "{}" } }), [summaryOfY]],
  ])("%s なら動かさない（異常系）", (_, plugin, summaries) => {
    // Arrange・Act
    const got = browserScriptPlugins([plugin], null, summaries);
    // Assert
    expect(got).toEqual([]);
  });

  it("browserProblem：ほかのパスはそのまま（境界値）", () => {
    // Arrange・Act
    const got = browserProblem(PROBLEM, "jp.other");
    // Assert
    expect(got).toEqual(PROBLEM);
  });
});

describe("removePrompt（削除の確認、F-PLUG-8）", () => {
  it("プロジェクトのプラグインは、ファイルと登録を消すことを示す", () => {
    // Arrange・Act
    const got = removePrompt(row(), 0, false);
    // Assert
    expect(got).toEqual({ text: "プラグイン「トレーサビリティのチェック」をこのプロジェクトから削除しますか？ .modelith/plugins/jp.x/ のファイルを削除し、プロジェクトの設定（modelith.json）からも登録を解除します。" });
  });

  it("データを保存しているこのブラウザのプラグインは、データも削除するかを尋ねる", () => {
    // Arrange・Act
    const got = removePrompt(row({ name: "レビューの記録", place: "browser" }), 2048, false);
    // Assert
    expect(got).toEqual({ text: "プラグイン「レビューの記録」をこのブラウザから削除しますか？", data: { label: "このプラグインがこのブラウザに保存したデータ（2 KB）" } });
  });

  it.each([
    ["データが無い（境界値: 0 バイト）", 0, false],
    ["同じ ID のプラグインがもう一方に残る", 10, true],
  ])("%s ときは、データについて尋ねない", (_, bytes, otherCopy) => {
    // Arrange・Act
    const got = removePrompt(row({ place: "browser" }), bytes, otherCopy);
    // Assert
    expect(got).not.toHaveProperty("data");
  });
});

describe("pluginFolderPath（フォルダを選ぶ入力欄で選んだファイル）", () => {
  it.each([
    ["フォルダの直下", "trace-rules/modelith-plugin.json", "modelith-plugin.json"],
    ["下のフォルダ", "trace-rules/rules/a.yaml", "rules/a.yaml"],
    ["隠しフォルダ（異常系）", "trace-rules/.git/config", null],
    ["隠しファイル（異常系）", "trace-rules/.DS_Store", null],
    ["node_modules（異常系）", "trace-rules/node_modules/x/a.js", null],
    ["フォルダの名前が無い（境界値）", "a.yaml", null],
  ])("%s", (_, input, expected) => {
    // Arrange・Act
    const got = pluginFolderPath(input);
    // Assert
    expect(got).toBe(expected);
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
      { id: "jp.y", name: "要求の ID の補完", version: "1.0.0", permissions: ["edits:propose"], commands: [{ id: "fill", title: "要求に ID を付ける" }], importers: [], exporters: [], code: "/* code */", settings: { prefix: "REQ" } },
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
