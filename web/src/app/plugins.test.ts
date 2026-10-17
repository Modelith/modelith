import { describe, expect, it } from "vitest";
import type { PluginInfo, PluginSummary, ProjectFile, RuleFinding } from "../core";
import { addPrompt, findingText, installFiles, isSafeName, loadProblemText, missingNotice, panelIntro, pluginNotes, pluginRows, pluginState, type PluginRow } from "./plugins";

/** 入っていて問題の無いプラグインのまとめ。 */
const summary = (over: Partial<PluginSummary> = {}): PluginSummary => ({
  id: "jp.x",
  enabled: true,
  installed: true,
  manifest: { id: "jp.x", name: "トレースの検査", version: "0.1.0", runtime: "rules" },
  rules: 2,
  problems: [],
  ...over,
});

const PROBLEM = { path: ".modelith/plugins/jp.x/rules.yaml", place: { line: 3, column: 5 }, message: "知らない項目「x」があります（…）" };

/** 一覧の行。 */
const row = (over: Partial<PluginRow> = {}): PluginRow => ({
  id: "jp.x",
  name: "トレースの検査",
  version: "0.1.0",
  wanted: "0.1.0",
  enabled: true,
  state: "ok",
  rules: 2,
  problems: [],
  ...over,
});

describe("pluginState（一覧の状態）", () => {
  it.each<[string, Parameters<typeof pluginState>, ReturnType<typeof pluginState>]>([
    ["止めている（入っていなくても）", [{ enabled: false }, undefined], "off"],
    ["まとめが無い（まだ読み込んでいない）", [{ enabled: true }, undefined], "missing"],
    ["入っていない", [{ enabled: true }, summary({ installed: false, manifest: null })], "missing"],
    ["版が違う", [{ enabled: true, version: "0.2.0" }, summary()], "version"],
    ["版を書いていない（どの版でもよい）", [{ enabled: true }, summary()], "ok"],
    ["読み込みの問題がある", [{ enabled: true, version: "0.1.0" }, summary({ problems: [PROBLEM] })], "error"],
    ["マニフェストが読めない（版を比べられない）", [{ enabled: true, version: "0.2.0" }, summary({ manifest: null, problems: [PROBLEM] })], "error"],
    ["使える", [{ enabled: true, version: "0.1.0" }, summary()], "ok"],
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
    expect(text).toBe(".modelith/plugins/jp.x/rules.yaml の 3 行目：知らない項目「x」があります（…）");
  });

  it("位置が無ければファイルだけを添える（境界値）", () => {
    // Arrange・Act
    const text = loadProblemText({ ...PROBLEM, place: null });
    // Assert
    expect(text).toBe(".modelith/plugins/jp.x/rules.yaml：知らない項目「x」があります（…）");
  });
});

describe("pluginRows（一覧の行）", () => {
  it("modelith.json の順に、名前・版・状態・ルールの数・問題を並べる", () => {
    // Arrange
    const project: ProjectFile = { plugins: { "jp.x": { version: "0.1.0", enabled: true }, "jp.y": { enabled: false } } };
    // Act
    const rows = pluginRows(project, [summary({ problems: [PROBLEM] })]);
    // Assert
    expect(rows).toEqual([
      { id: "jp.x", name: "トレースの検査", version: "0.1.0", wanted: "0.1.0", enabled: true, state: "error", rules: 2, problems: [loadProblemText(PROBLEM)] },
      { id: "jp.y", name: "jp.y", version: null, wanted: null, enabled: false, state: "off", rules: 0, problems: [] },
    ]);
  });

  it("使うプラグインが無ければ空（境界値）", () => {
    // Arrange・Act
    const rows = pluginRows({ plugins: {} }, []);
    // Assert
    expect(rows).toEqual([]);
  });
});

describe("missingNotice・pluginNotes（F-PLUG-9）", () => {
  it("入っていないプラグインは、ID を示して追加するかを尋ねる", () => {
    // Arrange・Act
    const text = missingNotice(row({ state: "missing", version: null }));
    // Assert
    expect(text).toBe("このプロジェクトはプラグイン「jp.x」を使っていますが、入っていません。追加しますか？");
  });

  it("版が違うプラグインは、両方の版を示す", () => {
    // Arrange・Act
    const text = missingNotice(row({ state: "version", wanted: "0.2.0" }));
    // Assert
    expect(text).toBe("このプロジェクトはプラグイン「トレースの検査」の版 0.2.0 を使っていますが、入っているのは版 0.1.0 です。合う版を追加しますか？");
  });

  it.each(["ok", "error", "off"] as const)("%s のときは案内しない", (state) => {
    // Arrange・Act
    const text = missingNotice(row({ state }));
    // Assert
    expect(text).toBeNull();
  });

  it("問題一覧には、足りないプラグイン（押すと追加）と読み込みの問題を出し、止めたものは出さない", () => {
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
      { msg: "このプロジェクトはプラグイン「jp.m」を使っていますが、入っていません。追加しますか？", add: "jp.m" },
      { msg: "プラグイン「トレースの検査」：a.yaml の 3 行目：x" },
    ]);
  });
});

describe("findingText（F-PLUG-1）", () => {
  const finding: RuleFinding = { plugin: "jp.x", rule: "req-sat", severity: "warning", message: "要求「R」を満たす要素がありません", element: "R", pos: 0 };

  it("プラグインの名前とルールの ID を添える", () => {
    // Arrange・Act
    const text = findingText(finding, new Map([["jp.x", "トレースの検査"]]));
    // Assert
    expect(text).toBe("要求「R」を満たす要素がありません（プラグイン「トレースの検査」のルール req-sat）");
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
    [{ kind: "unsupported" }, 0, false, /^このブラウザではフォルダを開けないため/],
    [{ kind: "noFolder" }, 0, false, /^プラグインは、プロジェクト（モデルのフォルダ）に入れて使います。「ファイル → フォルダを開く…」/],
    [{ kind: "folder", folderName: "water" }, 0, true, /^フォルダ「water」は、まだプロジェクトではありません/],
    [{ kind: "brokenProject" }, 0, false, /^プロジェクトの設定（modelith.json）に誤りがあるため/],
    [{ kind: "project", projectName: "給水" }, 0, true, /^プロジェクト「給水」には、まだプラグインがありません/],
    [{ kind: "project", projectName: "給水" }, 1, true, /^プロジェクト「給水」に入れたプラグインです/],
  ])("%o・%i 個 → 追加できる: %s", (place, count, canAdd, text) => {
    // Arrange・Act
    const intro = panelIntro(place, count);
    // Assert
    expect(intro.canAdd).toBe(canAdd);
    expect(intro.text).toMatch(text);
  });
});

describe("addPrompt（追加の確認、F-PLUG-8）", () => {
  const info: PluginInfo = { id: "jp.x", name: "トレースの検査", version: "0.1.0", runtime: "rules" };

  it("検査ルールのプラグインは、何を入れるか・プログラムを含まないこと・置き場所を示す", () => {
    // Arrange・Act
    const prompt = addPrompt(info, { plugins: {} }, false);
    // Assert
    expect(prompt).toEqual({
      text: "「トレースの検査」（ID：jp.x、版 0.1.0）を、このプロジェクトに追加します。検査ルールのプラグインです。モデルの決まりを書いたもので、プログラムは含みません。プラグインのファイルを .modelith/plugins/jp.x/ に写し、プロジェクトの設定（modelith.json）に書き加えます。Git で共有すると、チームの全員と CI が同じプラグインを使えます。",
      confirm: "追加する",
      askName: false,
    });
  });

  it("まだプロジェクトでなければ、プロジェクトにすることを伝えて名前を尋ねる（C-6）", () => {
    // Arrange・Act
    const prompt = addPrompt(info, null, false);
    // Assert
    expect(prompt).toMatchObject({ confirm: "プロジェクトにして追加", askName: true, text: expect.stringContaining("設定ファイル modelith.json をフォルダの一番上に作ります") as unknown });
  });

  it("入っているものを置き換えること、設定の版を書き換えることを伝える", () => {
    // Arrange
    const project: ProjectFile = { plugins: { "jp.x": { version: "0.2.0", enabled: true } } };
    // Act
    const prompt = addPrompt({ ...info, description: "要求のトレースを確かめます" }, project, true);
    // Assert
    if ("refused" in prompt) throw new Error(prompt.refused);
    expect(prompt.text).toContain("説明：要求のトレースを確かめます");
    expect(prompt.text).toContain("すでに入っているものは、置き換えます。");
    expect(prompt.text).toContain("プロジェクトの設定では版 0.2.0 を使うことになっています。追加すると、設定の版を 0.1.0 に書き換えます。");
  });

  it.each([
    ["browser", "「書き出し」は、画面に機能を足すプラグイン（TypeScript）です。この種類は、まだ追加できません。今追加できるのは、検査ルールのプラグインだけです"],
    ["wasm-component", "「書き出し」は、WebAssembly で動くプラグインです。この種類は、まだ追加できません。今追加できるのは、検査ルールのプラグインだけです"],
  ] as const)("%s のプラグインは、まだ追加できないと伝える（異常系）", (runtime, refused) => {
    // Arrange・Act
    const prompt = addPrompt({ ...info, name: "書き出し", runtime }, { plugins: {} }, false);
    // Assert
    expect(prompt).toEqual({ refused });
  });
});

describe("installFiles（プロジェクトに写す計画）", () => {
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
