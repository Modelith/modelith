// プラグイン（ADR-0018・ADR-0019）の画面の言葉と判断。入出力を持たない純粋関数だけを置く（読み書きは plugin-panel.ts）。

import type { PlacedDiagnostic, PluginFiles, PluginInfo, PluginLoadProblem, PluginRuntime, PluginSummary, PluginUse, ProjectFile, RuleFinding, RuleSeverity } from "../core";
import type { BrowserPlugin } from "../plugins/browser-store";
import type { Permission } from "../plugins/generated/protocol";
import { NETWORK_WARNING, permissionLines } from "../plugins/permissions";
import { sizeText } from "../plugins/transfer";
import type { ScriptPlugin } from "../plugins/view";

/** プロジェクトに入れたプラグインを置くフォルダ（プロジェクトのフォルダからの相対パス。ADR-0019 §1）。 */
export const PLUGINS_DIR = ".modelith/plugins";
/** プラグインのフォルダの中の、マニフェストのファイル名。 */
export const MANIFEST_FILE = "modelith-plugin.json";

/** プラグインを入れる先（ADR-0018 §1）。project は modelith.json と .modelith/plugins/、browser はこのブラウザの保存場所。 */
export type PluginPlace = "project" | "browser";

/** 入れる先の画面の言葉。 */
export const PLACE_LABEL: Record<PluginPlace, string> = { project: "このプロジェクト", browser: "このブラウザ" };

/** 一覧に出すプラグインの状態。shadowed は、同じ ID のプロジェクトのプラグインがあるため使わない、このブラウザのプラグイン。 */
export type PluginState = "ok" | "error" | "missing" | "version" | "off" | "shadowed";

/** 状態の画面の言葉。 */
export const STATE_LABEL: Record<PluginState, string> = {
  ok: "有効",
  error: "エラーあり",
  missing: "未追加",
  version: "バージョン不一致",
  off: "無効",
  shadowed: "プロジェクトを優先",
};

/** 同じ ID のプロジェクトのプラグインがあるため、このブラウザのプラグインを使わないことの説明。 */
export const SHADOWED_NOTICE = "このプロジェクトに同じ ID のプラグインがあるため、このプロジェクトではプロジェクトのものを使います（このブラウザのものは使いません）。";

/** プラグインの一覧の 1 行。 */
export interface PluginRow {
  id: string;
  /** 画面に出す名前（マニフェストの名前。読めなければ ID）。 */
  name: string;
  /** 追加されているバージョン（マニフェストのバージョン）。未追加・読めなければ null。 */
  version: string | null;
  /** プロジェクトの設定（modelith.json）に書かれたバージョン。書いていなければ null。 */
  wanted: string | null;
  enabled: boolean;
  state: PluginState;
  /** 有効なルールの数。 */
  rules: number;
  /** 読み込みの問題（「パス の 行 行目：理由」の文）。 */
  problems: string[];
  /** プラグインの種類（マニフェストの runtime）。読めなければ null。 */
  runtime: PluginRuntime | null;
  /** 宣言した権限。 */
  permissions: Permission[];
  /** メニューに出すコマンドの数。 */
  commands: number;
  /** 入れた先。 */
  place: PluginPlace;
}

/** 問題一覧に出す、プラグインについての 1 行。add があれば、押すとそのプラグインの追加を始める。 */
export interface PluginNote {
  msg: string;
  add?: string;
}

/**
 * プロジェクトが使うプラグイン 1 つの状態を決める。無効 → 未追加 → バージョン不一致 → エラーあり → 有効、の順に見る。
 *
 * @param use modelith.json に書かれた、そのプラグインの設定
 * @param summary コアが読み込んだまとめ（まだ読み込んでいなければ undefined。未追加とみなす）
 * @returns 状態
 * @example
 * pluginState({ enabled: false }, summary)                                  // → "off"
 * pluginState({ enabled: true }, { installed: false, … })                   // → "missing"
 * pluginState({ enabled: true, version: "0.2.0" }, { manifest: { version: "0.1.0" }, … }) // → "version"
 * pluginState({ enabled: true }, { installed: true, problems: [p], … })     // → "error"
 * pluginState({ enabled: true }, { installed: true, problems: [], … })      // → "ok"
 */
export function pluginState(use: PluginUse, summary: PluginSummary | undefined): PluginState {
  if (!use.enabled) return "off";
  if (!summary?.installed) return "missing";
  if (use.version && summary.manifest && summary.manifest.version !== use.version) return "version";
  return summary.problems.length ? "error" : "ok";
}

/**
 * 読み込みの問題 1 件を、ファイルと行を添えた文にする（F-PLUG-3）。
 *
 * @param p 読み込みの問題
 * @returns 「パス の 行 行目：理由」。位置が無ければ「パス：理由」
 * @example
 * loadProblemText({ path: ".modelith/plugins/jp.x/rules.yaml", place: { line: 3, column: 5 }, message: "不明な項目「x」があります（…）" })
 * // → ".modelith/plugins/jp.x/rules.yaml の 3 行目：不明な項目「x」があります（…）"
 * loadProblemText({ path: "modelith.json", place: null, message: "…" }) // → "modelith.json：…"
 */
export function loadProblemText(p: PluginLoadProblem): string {
  return p.place ? `${p.path} の ${p.place.line} 行目：${p.message}` : `${p.path}：${p.message}`;
}

/**
 * プロジェクトの設定とコアのまとめから、プラグインの一覧の行を作る（modelith.json に書いた順）。
 *
 * @param project 読み取ったプロジェクトの設定
 * @param summaries コアが読み込んだプラグインのまとめ
 * @returns 一覧の行。使うプラグインが無ければ空
 * @example
 * pluginRows({ plugins: { "jp.x": { version: "0.1.0", enabled: true } } }, [{ id: "jp.x", installed: true, manifest: { name: "トレーサビリティのチェック", version: "0.1.0", … }, rules: 2, problems: [] }])
 * // → [{ id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", wanted: "0.1.0", enabled: true, state: "ok", rules: 2, problems: [] }]
 * pluginRows({ plugins: { "jp.y": { enabled: true } } }, []) // → [{ id: "jp.y", name: "jp.y", version: null, state: "missing", … }]
 */
export function pluginRows(project: ProjectFile, summaries: readonly PluginSummary[]): PluginRow[] {
  return Object.entries(project.plugins).map(([id, use]) => {
    const summary = summaries.find((s) => s.id === id);
    return {
      id,
      name: summary?.manifest?.name ?? id,
      version: summary?.installed ? (summary.manifest?.version ?? null) : null,
      wanted: use.version ?? null,
      enabled: use.enabled,
      state: pluginState(use, summary),
      rules: summary?.rules ?? 0,
      problems: (summary?.problems ?? []).map(loadProblemText),
      runtime: summary?.manifest?.runtime ?? null,
      permissions: summary?.manifest?.permissions ?? [],
      commands: summary?.manifest?.commands?.length ?? 0,
      place: "project" as const,
    };
  });
}

/**
 * このブラウザに入れたプラグインが、同じ ID のプロジェクトのプラグインに隠されるか（ADR-0018 §1：プロジェクトのものが優先）。
 * modelith.json に書かれていれば、未追加・無効でもプロジェクトの決めたことを優先する（チームと CI と同じ結果にするため）。
 *
 * @param id プラグインの ID
 * @param project 読み取ったプロジェクトの設定（無ければ null。隠さない）
 * @returns 隠されるなら true
 * @example
 * isShadowed("jp.x", { plugins: { "jp.x": { enabled: false } } }) // → true
 * isShadowed("jp.x", { plugins: {} })                              // → false
 * isShadowed("jp.x", null)                                         // → false
 */
export function isShadowed(id: string, project: ProjectFile | null): boolean {
  return !!project && Object.hasOwn(project.plugins, id);
}

/**
 * コアが返した読み込みの問題のパス（`.modelith/plugins/<ID>/…`）を、このブラウザに入れたプラグインのパスとして示す形にする。
 *
 * @param p 読み込みの問題
 * @param id プラグインの ID
 * @returns パスを「このブラウザの <ID>/…」にした問題
 * @example
 * browserProblem({ path: ".modelith/plugins/jp.x/rules.yaml", … }, "jp.x") // → { path: "このブラウザの jp.x/rules.yaml", … }
 * browserProblem({ path: "other.yaml", … }, "jp.x")                       // → { path: "other.yaml", … }（そのまま）
 */
export function browserProblem(p: PluginLoadProblem, id: string): PluginLoadProblem {
  const prefix = `${PLUGINS_DIR}/${id}/`;
  return p.path.startsWith(prefix) ? { ...p, path: `このブラウザの ${id}/${p.path.slice(prefix.length)}` } : p;
}

/**
 * このブラウザに入れたプラグインの、一覧の行を作る（ID の順）。同じ ID のプロジェクトのプラグインがあれば「プロジェクトを優先」にする。
 *
 * @param plugins このブラウザに入れたプラグイン
 * @param project 読み取ったプロジェクトの設定（無ければ null）
 * @param summaries コアが読み込んだプラグインのまとめ（隠されたものは含まない）
 * @returns 一覧の行
 * @example
 * browserRows([{ id: "jp.y", enabled: true, info: { name: "レビューの記録", version: "1.0.0", runtime: "browser", … }, files }], null, [summaryOfY])
 * // → [{ id: "jp.y", name: "レビューの記録", state: "ok", place: "browser", … }]
 * browserRows([{ id: "jp.x", … }], { plugins: { "jp.x": { enabled: true } } }, summaries)
 * // → [{ id: "jp.x", state: "shadowed", place: "browser", … }]
 */
export function browserRows(plugins: readonly BrowserPlugin[], project: ProjectFile | null, summaries: readonly PluginSummary[]): PluginRow[] {
  return [...plugins]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => {
      const shadowed = isShadowed(p.id, project);
      const summary = shadowed ? undefined : summaries.find((s) => s.id === p.id);
      const m = summary?.manifest ?? p.info;
      const problems = (summary?.problems ?? []).map((x) => loadProblemText(browserProblem(x, p.id)));
      const state: PluginState = shadowed ? "shadowed" : !p.enabled ? "off" : problems.length ? "error" : "ok";
      return {
        id: p.id,
        name: m.name,
        version: m.version,
        wanted: null,
        enabled: p.enabled,
        state,
        rules: summary?.rules ?? 0,
        problems,
        runtime: m.runtime,
        permissions: m.permissions ?? [],
        commands: m.commands?.length ?? 0,
        place: "browser" as const,
      };
    });
}

/**
 * このブラウザに入れたプラグインのうち、コアに読み込ませるもの（同じ ID のプロジェクトのプラグインが無いもの）を選ぶ。
 *
 * @param plugins このブラウザに入れたプラグイン
 * @param project 読み取ったプロジェクトの設定（無ければ null）
 * @returns コアに渡すプラグインのファイル
 * @example
 * browserPluginFiles([{ id: "jp.y", enabled: true, files: { … }, … }], null) // → [{ id: "jp.y", enabled: true, files: { … } }]
 * browserPluginFiles([{ id: "jp.x", … }], { plugins: { "jp.x": {…} } })      // → []（プロジェクトのものが優先）
 */
export function browserPluginFiles(plugins: readonly BrowserPlugin[], project: ProjectFile | null): PluginFiles[] {
  return plugins.filter((p) => !isShadowed(p.id, project)).map((p) => ({ id: p.id, enabled: p.enabled, files: p.files }));
}

/**
 * 動かす v1 のプラグイン（TypeScript）を選ぶ。プロジェクトで有効で、追加されていて、読み込みの問題が無く、プログラムのファイルがあるものだけ（ADR-0018 §3）。
 *
 * @param project 読み取ったプロジェクトの設定（無ければ null。何も動かさない）
 * @param summaries コアが読み込んだプラグインのまとめ
 * @param files プラグインごとのファイル（プラグインのフォルダからの相対パス → テキスト）
 * @returns 動かすプラグイン（modelith.json に書いた順）
 * @example
 * scriptPlugins({ plugins: { "jp.x": { enabled: true, settings: { a: 1 } } } }, [{ id: "jp.x", installed: true, problems: [], manifest: { runtime: "browser", main: "main.js", … } }], [{ id: "jp.x", files: { "main.js": "…" } }])
 * // → [{ id: "jp.x", name: …, version: …, permissions: [], commands: [], code: "…", settings: { a: 1 } }]
 * scriptPlugins(project, [{ …, manifest: { runtime: "rules", … } }], files) // → []（チェックルールのプラグイン）
 * scriptPlugins(null, summaries, files)                                   // → []
 */
export function scriptPlugins(project: ProjectFile | null, summaries: readonly PluginSummary[], files: readonly PluginFiles[]): ScriptPlugin[] {
  if (!project) return [];
  return Object.entries(project.plugins).flatMap(([id, use]) => {
    const m = summaries.find((s) => s.id === id && s.installed && !s.problems.length)?.manifest;
    const code = m?.main ? files.find((f) => f.id === id)?.files[m.main] : undefined;
    if (!use.enabled || !m || m.runtime !== "browser" || code === undefined) return [];
    return [{ ...scriptOf(m, code), ...(use.settings === undefined ? {} : { settings: use.settings }) }];
  });
}

/**
 * 動かす v1 のプラグインを、このブラウザに入れたものから選ぶ。有効で、同じ ID のプロジェクトのプラグインが無く、
 * コアが読み込めて、プログラムのファイルがあるものだけ（ADR-0018 §1・§3）。
 *
 * @param plugins このブラウザに入れたプラグイン
 * @param project 読み取ったプロジェクトの設定（無ければ null）
 * @param summaries コアが読み込んだプラグインのまとめ
 * @returns 動かすプラグイン（設定は持たない）
 * @example
 * browserScriptPlugins([{ id: "jp.y", enabled: true, files: { "main.js": "…", … }, … }], null, [{ id: "jp.y", installed: true, problems: [], manifest: { runtime: "browser", main: "main.js", … } }])
 * // → [{ id: "jp.y", …, code: "…" }]
 * browserScriptPlugins([{ id: "jp.x", … }], { plugins: { "jp.x": {…} } }, summaries) // → []（プロジェクトのものが優先）
 */
export function browserScriptPlugins(plugins: readonly BrowserPlugin[], project: ProjectFile | null, summaries: readonly PluginSummary[]): ScriptPlugin[] {
  return plugins.flatMap((p) => {
    const m = summaries.find((s) => s.id === p.id && s.installed && !s.problems.length)?.manifest;
    const code = m?.main ? p.files[m.main] : undefined;
    if (!p.enabled || isShadowed(p.id, project) || !m || m.runtime !== "browser" || code === undefined) return [];
    return [scriptOf(m, code)];
  });
}

/**
 * マニフェストの情報とプログラムから、動かすプラグインを作る。
 *
 * @param m マニフェストの情報
 * @param code プログラムのファイルの中身
 * @returns 動かすプラグイン（設定は持たない）
 * @example
 * scriptOf({ id: "jp.y", name: "n", version: "1.0.0", runtime: "browser", commands: [c] }, "…")
 * // → { id: "jp.y", name: "n", version: "1.0.0", permissions: [], commands: [c], importers: [], exporters: [], code: "…" }
 */
function scriptOf(m: PluginInfo, code: string): ScriptPlugin {
  return { id: m.id, name: m.name, version: m.version, permissions: m.permissions ?? [], commands: m.commands ?? [], importers: m.importers ?? [], exporters: m.exporters ?? [], code };
}

/**
 * 未追加・バージョン不一致のプラグインについて、何が足りないかと、追加するかを尋ねる文を作る（F-PLUG-9）。
 *
 * @param row 一覧の行
 * @returns 案内の文。無効・追加済みでバージョンも合うなら null
 * @example
 * missingNotice({ id: "jp.x", state: "missing", … })
 * // → "このプロジェクトで使うプラグイン「jp.x」が追加されていません。追加しますか？"
 * missingNotice({ name: "トレーサビリティのチェック", state: "version", wanted: "0.2.0", version: "0.1.0", … })
 * // → "このプロジェクトはプラグイン「トレーサビリティのチェック」のバージョン 0.2.0 を使いますが、追加されているのはバージョン 0.1.0 です。バージョン 0.2.0 を追加しますか？"
 * missingNotice({ state: "ok", … }) // → null
 */
export function missingNotice(row: PluginRow): string | null {
  if (row.state === "missing") return `このプロジェクトで使うプラグイン「${row.id}」が追加されていません。追加しますか？`;
  if (row.state === "version") {
    const wanted = row.wanted ?? "";
    return `このプロジェクトはプラグイン「${row.name}」のバージョン ${wanted} を使いますが、追加されているのはバージョン ${row.version ?? ""} です。バージョン ${wanted} を追加しますか？`;
  }
  return null;
}

/**
 * 問題一覧に出す、プラグインについての行を作る。有効なプラグインだけを見る（無効にしたものは出さない）。
 * 足りないプラグインは追加を尋ねる行（押すと追加を始める）、読み込みの問題はプラグインの名前とファイル・行を添えた行にする（F-PLUG-3・F-PLUG-9）。
 *
 * @param rows 一覧の行
 * @returns 問題一覧の行（一覧の順）
 * @example
 * pluginNotes([{ id: "jp.x", state: "missing", enabled: true, … }])
 * // → [{ msg: "このプロジェクトで使うプラグイン「jp.x」が追加されていません。追加しますか？", add: "jp.x" }]
 * pluginNotes([{ name: "トレーサビリティのチェック", state: "error", enabled: true, problems: ["….yaml の 3 行目：…"], … }])
 * // → [{ msg: "プラグイン「トレーサビリティのチェック」：….yaml の 3 行目：…" }]
 * pluginNotes([{ state: "off", … }]) // → []
 */
export function pluginNotes(rows: readonly PluginRow[]): PluginNote[] {
  return rows.flatMap((row) => {
    if (!row.enabled) return [];
    const notice = missingNotice(row);
    // 未追加のプラグインの「マニフェストが見つからない」は、追加を尋ねる行と同じことなので重ねない
    const problems = row.state === "missing" ? [] : row.problems.map((p) => ({ msg: `プラグイン「${row.name}」：${p}` }));
    return notice ? [{ msg: notice, add: row.id }, ...problems] : problems;
  });
}

/**
 * チェックルールの結果を、問題一覧に出す文にする。どのプラグインのどのルールかを添える（F-PLUG-1）。
 *
 * @param f チェックルールの結果
 * @param names プラグインの ID → 画面に出す名前（無ければ ID を出す）
 * @returns 「結果の文（プラグイン「名前」のルール ID）」
 * @example
 * findingText({ plugin: "jp.x", rule: "req-sat", message: "要求「R」を満たす要素がありません", … }, new Map([["jp.x", "トレーサビリティのチェック"]]))
 * // → "要求「R」を満たす要素がありません（プラグイン「トレーサビリティのチェック」のルール req-sat）"
 * findingText({ plugin: "jp.y", rule: "r1", message: "m", … }, new Map()) // → "m（プラグイン「jp.y」のルール r1）"
 */
export function findingText(f: RuleFinding, names: ReadonlyMap<string, string>): string {
  return `${f.message}（プラグイン「${names.get(f.plugin) ?? f.plugin}」のルール ${f.rule}）`;
}

/**
 * v1 のプラグインの診断を、問題一覧に出す文にする。どのプラグインの診断かを添える（code があれば、それも）。
 *
 * @param d 診断（位置はテキストの UTF-16）
 * @param name プラグインの画面に出す名前
 * @returns 「診断の文（プラグイン「名前」の code）」。code が無ければ「診断の文（プラグイン「名前」）」
 * @example
 * diagnosticText({ message: "要求「R」に ID がありません", code: "req-id", … }, "要求の ID の補完") // → "要求「R」に ID がありません（プラグイン「要求の ID の補完」の req-id）"
 * diagnosticText({ message: "m", … }, "jp.y")                                                     // → "m（プラグイン「jp.y」）"
 */
export function diagnosticText(d: PlacedDiagnostic, name: string): string {
  return `${d.message}（プラグイン「${name}」${d.code ? `の ${d.code}` : ""}）`;
}

/** チェックルールの結果の重大度ごとの印（問題一覧の行の頭）。 */
export const SEVERITY_MARK: Record<RuleSeverity, string> = { error: "⚠", warning: "△", information: "ℹ", hint: "ℹ" };

/** プラグインの一覧の画面が置かれた場面。 */
export type PanelPlace =
  | { kind: "unsupported" }
  | { kind: "noFolder" }
  | { kind: "folder"; folderName: string }
  | { kind: "brokenProject" }
  | { kind: "project"; projectName: string };

/**
 * プラグインの一覧の画面の、最初の案内を決める。プロジェクトに追加できない場面では、このブラウザに追加できることと、
 * チームと共有するにはプロジェクトに追加することを示す（ADR-0018 §1・ADR-0019 §4）。「追加」はどの場面でも押せる（このブラウザに追加できる）。
 *
 * @param place 場面（フォルダを開けないブラウザ・フォルダ無し・プロジェクトでないフォルダ・読めない設定・プロジェクト）
 * @param count プロジェクトのプラグインの数（プロジェクトのとき）
 * @returns 案内の文
 * @example
 * panelIntro({ kind: "noFolder" }, 0)                 // → "フォルダを開いていないため、プラグインはこのブラウザにだけ追加できます。…"
 * panelIntro({ kind: "project", projectName: "給水システム" }, 0) // → "プロジェクト「給水システム」にはまだプラグインがありません。…"
 */
export function panelIntro(place: PanelPlace, count: number): string {
  switch (place.kind) {
    case "unsupported":
      return "このブラウザはフォルダを開けないため、プラグインはこのブラウザにだけ追加できます（自分だけが使えます）。プロジェクトに追加してチームや CI と共有するには、Chrome・Edge でモデルのフォルダを開いてください。";
    case "noFolder":
      return "フォルダを開いていないため、プラグインはこのブラウザにだけ追加できます（自分だけが使えます）。チームや CI と共有するには、「ファイル → フォルダを開く…」でモデルのフォルダを開き、プロジェクトに追加してください。単独で開いたファイルやサンプルは、プロジェクトではありません。";
    case "folder":
      return `フォルダ「${place.folderName}」はまだプロジェクトではありません。「追加…」でプラグインのフォルダを選び、追加先に「このプロジェクト」を選ぶと、このフォルダをプロジェクトにしてから追加します（設定ファイル modelith.json を作成します）。`;
    case "brokenProject":
      return "プロジェクトの設定（modelith.json）にエラーがあるため、プロジェクトのプラグインを使用できません。設定ファイルを修正してから、エクスプローラーの「一覧を更新」（↻）を押してください。このブラウザへの追加はできます。";
    case "project":
      return count
        ? `プロジェクト「${place.projectName}」に追加されているプラグインです。チェックルールの結果は、テキストの下の問題一覧に表示されます。`
        : `プロジェクト「${place.projectName}」にはまだプラグインがありません。「追加…」を押して、プラグインのフォルダを選んでください。`;
  }
}

/**
 * その場面で「このプロジェクト」に追加できない理由を返す。
 *
 * @param place 場面
 * @returns 理由の文。追加できるなら null
 * @example
 * projectBlocked({ kind: "noFolder" })                              // → "フォルダを開いていないため選べません。「ファイル → フォルダを開く…」で開けます"
 * projectBlocked({ kind: "project", projectName: "給水システム" })    // → null
 * projectBlocked({ kind: "folder", folderName: "water" })           // → null（プロジェクトにしてから追加する）
 */
export function projectBlocked(place: PanelPlace): string | null {
  switch (place.kind) {
    case "unsupported":
      return "このブラウザはフォルダを開けないため選べません";
    case "noFolder":
      return "フォルダを開いていないため選べません。「ファイル → フォルダを開く…」で開けます";
    case "brokenProject":
      return "プロジェクトの設定（modelith.json）にエラーがあるため選べません";
    case "folder":
    case "project":
      return null;
  }
}

/** 追加先の選択肢 1 つ。 */
export interface PlaceOption {
  id: PluginPlace;
  label: string;
  /** 選択肢の説明（どこに置くか・誰が使えるか）。選べないときは、その理由。 */
  note: string;
  /** 選べないなら true。 */
  disabled: boolean;
  /** これを選んだときの、追加するボタンの文言。 */
  confirm: string;
  /** これを選んだときに、プロジェクトの名前を尋ねるか（まだプロジェクトでないフォルダ）。 */
  askName: boolean;
}

/** 「追加」の確認ダイアログの中身。 */
export interface AddPrompt {
  text: string;
  /** 追加先の選択肢（このプロジェクト・このブラウザの順）。 */
  places: PlaceOption[];
  /** 始めに選んでおく追加先（このプロジェクトに追加できれば、このプロジェクト）。 */
  initial: PluginPlace;
  /** 本文の下に出す、使う権限の言葉（画面に機能を追加するプラグインのとき）。 */
  items?: string[];
  /** 外部と通信できるプラグインについての注意。 */
  warning?: string;
}

/** 追加先を決めるための、今の状態。 */
export interface AddTarget {
  /** 今のプロジェクトの設定。まだプロジェクトでないフォルダ・フォルダが無いなら null。 */
  project: ProjectFile | null;
  /** 「このプロジェクト」に追加できない理由（projectBlocked）。追加できるなら null。 */
  blocked: string | null;
  /** 同じ ID のプラグインが、このプロジェクトにすでに追加されているか。 */
  inProject: boolean;
  /** 同じ ID のプラグインが、このブラウザにすでに追加されているか。 */
  inBrowser: boolean;
}

/**
 * 選んだプラグインを追加する前に示す、確認の中身を作る。追加先は「このプロジェクト」（既定）か「このブラウザ」から選ぶ（ADR-0018 §1）。
 * 画面に機能を追加するプラグイン（TypeScript）は、使う権限と、外部と通信できるならその注意も示す（ADR-0018 §5）。
 * WebAssembly で動くプラグインは、まだ追加できないと伝える。
 *
 * @param info マニフェストから読んだ、プラグインの情報
 * @param target 今のプロジェクト・プロジェクトに追加できない理由・同じ ID のプラグインが追加済みか
 * @returns 確認の中身。追加できない種類なら `{ refused: 理由の文 }`
 * @example
 * addPrompt({ id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", runtime: "rules" }, { project: { plugins: {} }, blocked: null, inProject: false, inBrowser: false })
 * // → { text: "「トレーサビリティのチェック」（ID：jp.x、バージョン 0.1.0）を追加します。チェックルールのプラグインです。…", initial: "project",
 * //      places: [{ id: "project", note: ".modelith/plugins/jp.x/ にコピーし、…", confirm: "追加する", … }, { id: "browser", note: "このブラウザだけに保存します。…", … }] }
 * addPrompt(info, { project: null, blocked: "フォルダを開いていないため選べません。…", … }) // → { …, initial: "browser", places: [{ id: "project", disabled: true, … }, …] }
 * addPrompt({ name: "解析", runtime: "wasm-component", … }, target) // → { refused: "「解析」は、WebAssembly で動くプラグインです。この種類はまだ追加できません。…" }
 */
export function addPrompt(info: PluginInfo, target: AddTarget): AddPrompt | { refused: string } {
  if (info.runtime === "wasm-component") {
    return { refused: `「${info.name}」は、WebAssembly で動くプラグインです。この種類はまだ追加できません。現在追加できるのは、チェックルールのプラグインと、画面に機能を追加するプラグイン（TypeScript）です` };
  }
  const script = info.runtime === "browser";
  const permissions = info.permissions ?? [];
  const parts = [
    `「${info.name}」（ID：${info.id}、バージョン ${info.version}）を追加します。`,
    info.description ? `説明：${info.description}` : "",
    script
      ? "画面に機能を追加するプラグイン（TypeScript）です。プログラムを含み、下の権限を使います。初めて実行する前に、実行してよいかを確認します。"
      : "チェックルールのプラグインです。モデルのルールを記述したもので、プログラムは含みません。",
  ];
  const places = [projectOption(info, target, script), browserOption(info, target, script)];
  const prompt: AddPrompt = { text: parts.filter(Boolean).join(""), places, initial: target.blocked === null ? "project" : "browser" };
  if (!script) return prompt;
  return { ...prompt, items: permissionLines(permissions), ...(permissions.includes("network") ? { warning: NETWORK_WARNING } : {}) };
}

/**
 * 追加先「このプロジェクト」の選択肢を作る。
 *
 * @param info プラグインの情報
 * @param target 今の状態
 * @param script 画面に機能を追加するプラグイン（TypeScript）か（CLI では動かないので、CI の共有を書かない）
 * @returns 選択肢
 * @example
 * projectOption(info, { project: { plugins: {} }, blocked: null, inProject: true, … }, false)
 * // → { id: "project", label: "このプロジェクト", note: ".modelith/plugins/jp.x/ にコピーし、…追加済みのプラグインは上書きされます。", disabled: false, confirm: "追加する", askName: false }
 */
function projectOption(info: PluginInfo, target: AddTarget, script: boolean): PlaceOption {
  const label = PLACE_LABEL.project;
  if (target.blocked !== null) return { id: "project", label, note: target.blocked, disabled: true, confirm: "追加する", askName: false };
  const project = target.project;
  const wanted = project?.plugins[info.id]?.version;
  const note = [
    `${PLUGINS_DIR}/${info.id}/ にコピーし、プロジェクトの設定（modelith.json）に登録します。Git で共有すると、チームの全員${script ? "" : "と CI "}が同じプラグインを使えます。`,
    target.inProject ? "追加済みのプラグインは上書きされます。" : "",
    wanted && wanted !== info.version ? `プロジェクトの設定ではバージョン ${wanted} が指定されています。追加すると、設定のバージョンを ${info.version} に変更します。` : "",
    project ? "" : "このフォルダはまだプロジェクトではないため、プロジェクトにします（設定ファイル modelith.json をフォルダの直下に作成します）。プロジェクト名を入力してください。",
  ];
  return { id: "project", label, note: note.filter(Boolean).join(""), disabled: false, confirm: project ? "追加する" : "プロジェクトにして追加", askName: !project };
}

/**
 * 追加先「このブラウザ」の選択肢を作る。
 *
 * @param info プラグインの情報
 * @param target 今の状態
 * @param script 画面に機能を追加するプラグイン（TypeScript）か
 * @returns 選択肢
 * @example
 * browserOption(info, { project: { plugins: { "jp.x": {…} } }, inBrowser: false, … }, false)
 * // → { id: "browser", note: "このブラウザだけに保存します。…このプロジェクトには同じ ID のプラグインがあるため、…", disabled: false, confirm: "追加する", askName: false }
 */
function browserOption(info: PluginInfo, target: AddTarget, script: boolean): PlaceOption {
  const note = [
    `このブラウザだけに保存します。どのプロジェクトでも、フォルダを開かなくても使えます。ほかの人${script ? "" : "や CI（modelith check）"}とは共有されません。`,
    target.inBrowser ? "このブラウザに追加済みのプラグインは上書きされます。" : "",
    isShadowed(info.id, target.project) ? "このプロジェクトには同じ ID のプラグインがあるため、このプロジェクトではプロジェクトのものを使います。" : "",
  ];
  return { id: "browser", label: PLACE_LABEL.browser, note: note.filter(Boolean).join(""), disabled: false, confirm: "追加する", askName: false };
}

/** 削除の確認ダイアログの中身。 */
export interface RemovePrompt {
  text: string;
  /** このブラウザに保存された、プラグインのデータを残すか削除するかの選択。尋ねないなら省く。 */
  data?: { label: string };
}

/**
 * プラグインを削除する前に示す、確認の中身を作る。プラグインがこのブラウザにデータを保存していて、
 * 削除すると同じ ID のプラグインが残らないときは、そのデータも削除するかを尋ねる（F-PLUG-8）。
 *
 * @param row 一覧の行
 * @param dataBytes このブラウザに保存された、そのプラグインのデータの大きさ（UTF-8 のバイト数。無ければ 0）
 * @param otherCopy 同じ ID のプラグインが、もう一方の追加先にもあるか（あればデータは残す）
 * @returns 確認の中身
 * @example
 * removePrompt({ name: "トレーサビリティのチェック", id: "jp.x", place: "project", … }, 0, false)
 * // → { text: "プラグイン「トレーサビリティのチェック」をこのプロジェクトから削除しますか？ .modelith/plugins/jp.x/ のファイルを削除し、…" }
 * removePrompt({ name: "レビューの記録", place: "browser", … }, 2048, false)
 * // → { text: "プラグイン「レビューの記録」をこのブラウザから削除しますか？", data: { label: "このプラグインがこのブラウザに保存したデータ（2 KB）" } }
 */
export function removePrompt(row: PluginRow, dataBytes: number, otherCopy: boolean): RemovePrompt {
  const text =
    row.place === "project"
      ? `プラグイン「${row.name}」をこのプロジェクトから削除しますか？ ${PLUGINS_DIR}/${row.id}/ のファイルを削除し、プロジェクトの設定（modelith.json）からも登録を解除します。`
      : `プラグイン「${row.name}」をこのブラウザから削除しますか？`;
  return dataBytes > 0 && !otherCopy ? { text, data: { label: `このプラグインがこのブラウザに保存したデータ（${sizeText(dataBytes)}）` } } : { text };
}

/**
 * フォルダを選ぶ入力欄（webkitdirectory）で選んだファイルの、選んだフォルダからの相対パスを求める。
 * 隠しファイル・隠しフォルダ・node_modules の中のファイルは読まない（プロジェクトのフォルダを読むときと同じ）。
 *
 * @param relativePath ブラウザが示した相対パス（`File.webkitRelativePath`。先頭は選んだフォルダの名前）
 * @returns 選んだフォルダからの相対パス。読まないファイルなら null
 * @example
 * pluginFolderPath("trace-rules/rules/a.yaml")  // → "rules/a.yaml"
 * pluginFolderPath("trace-rules/.git/config")   // → null（隠しフォルダ）
 * pluginFolderPath("trace-rules/node_modules/x") // → null
 * pluginFolderPath("a.yaml")                    // → null（境界値: フォルダの名前が無い）
 */
export function pluginFolderPath(relativePath: string): string | null {
  const segs = relativePath.split("/").slice(1);
  if (!segs.length || segs.some((x) => x === "" || x.startsWith(".") || x === "node_modules")) return null;
  return segs.join("/");
}

/**
 * 選んだプラグインのフォルダのファイルを、プロジェクトの中の置き場所（`.modelith/plugins/<ID>/…`）にコピーする計画にする。
 * プラグインのフォルダの外を指すパスは受け付けない。
 *
 * @param id プラグインの ID（マニフェストの ID。コアが形を確かめたもの）
 * @param files プラグインのフォルダからの相対パス → テキスト
 * @returns プロジェクトのフォルダからの相対パスとテキストの組。マニフェストが無い・外を指すパスがあれば `{ refused: 理由の文 }`
 * @example
 * installFiles("jp.x", { "modelith-plugin.json": "{…}", "rules/a.yaml": "…" })
 * // → { files: [[".modelith/plugins/jp.x/modelith-plugin.json", "{…}"], [".modelith/plugins/jp.x/rules/a.yaml", "…"]] }
 * installFiles("jp.x", { "../a.yaml": "…", "modelith-plugin.json": "{}" }) // → { refused: "プラグインのファイル「../a.yaml」は、プラグインのフォルダの外を指しています" }
 * installFiles("jp.x", {}) // → { refused: "プラグインのフォルダに modelith-plugin.json がありません" }
 */
export function installFiles(id: string, files: Readonly<Record<string, string>>): { files: [string, string][] } | { refused: string } {
  if (!(MANIFEST_FILE in files)) return { refused: `プラグインのフォルダに ${MANIFEST_FILE} がありません` };
  const out: [string, string][] = [];
  for (const [path, text] of Object.entries(files)) {
    const segs = path.split("/");
    if (!isSafeName(id) || segs.some((s) => !isSafeName(s))) return { refused: `プラグインのファイル「${path}」は、プラグインのフォルダの外を指しています` };
    out.push([`${PLUGINS_DIR}/${id}/${path}`, text]);
  }
  return { files: out };
}

/**
 * フォルダやファイルの名前 1 つとして、そのまま使えるか（空・`.`・`..`・区切りの文字を含まない）。
 *
 * @param name 名前
 * @returns 使えれば true
 * @example
 * isSafeName("jp.example.rules") // → true
 * isSafeName("..")               // → false
 * isSafeName("a/b")              // → false
 * isSafeName("")                 // → false（境界値）
 */
export function isSafeName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\:]/.test(name);
}
