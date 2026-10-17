// プラグイン（ADR-0018・ADR-0019）の画面の言葉と判断。入出力を持たない純粋関数だけを置く（読み書きは plugin-panel.ts）。

import type { PluginInfo, PluginLoadProblem, PluginRuntime, PluginSummary, PluginUse, ProjectFile, RuleFinding, RuleSeverity } from "../core";

/** プロジェクトに入れたプラグインを置くフォルダ（プロジェクトのフォルダからの相対パス。ADR-0019 §1）。 */
export const PLUGINS_DIR = ".modelith/plugins";
/** プラグインのフォルダの中の、マニフェストのファイル名。 */
export const MANIFEST_FILE = "modelith-plugin.json";

/** 一覧に出すプラグインの状態。 */
export type PluginState = "ok" | "error" | "missing" | "version" | "off";

/** 状態の画面の言葉。 */
export const STATE_LABEL: Record<PluginState, string> = {
  ok: "有効",
  error: "エラーあり",
  missing: "未追加",
  version: "バージョン不一致",
  off: "無効",
};

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
    };
  });
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
 * プラグインの一覧の画面の、最初の案内と「追加」を押せるかを決める。プロジェクトが無ければ、プロジェクトに追加して使うことと、その作り方を示す。
 *
 * @param place 場面（フォルダを開けないブラウザ・フォルダ無し・プロジェクトでないフォルダ・読めない設定・プロジェクト）
 * @param count プロジェクトのプラグインの数（プロジェクトのとき）
 * @returns 案内の文と、「追加」を押せるか
 * @example
 * panelIntro({ kind: "noFolder" }, 0)                 // → { text: "プラグインは、プロジェクト（モデルのフォルダ）に追加して使います。…", canAdd: false }
 * panelIntro({ kind: "project", projectName: "給水システム" }, 0) // → { text: "プロジェクト「給水システム」にはまだプラグインがありません。…", canAdd: true }
 */
export function panelIntro(place: PanelPlace, count: number): { text: string; canAdd: boolean } {
  switch (place.kind) {
    case "unsupported":
      return { text: "このブラウザはフォルダを開けないため、プラグインを使用できません（Chrome・Edge で使用できます）。プラグインは、プロジェクト（モデルのフォルダ）に追加して使います。", canAdd: false };
    case "noFolder":
      return {
        text: "プラグインは、プロジェクト（モデルのフォルダ）に追加して使います。「ファイル → フォルダを開く…」でモデルのフォルダを開くと、追加できるようになります。単独で開いたファイルやサンプルには追加できません。",
        canAdd: false,
      };
    case "folder":
      return {
        text: `フォルダ「${place.folderName}」はまだプロジェクトではありません。「追加…」でプラグインのフォルダを選ぶと、このフォルダをプロジェクトにしてから追加します（設定ファイル modelith.json を作成します）。`,
        canAdd: true,
      };
    case "brokenProject":
      return { text: "プロジェクトの設定（modelith.json）にエラーがあるため、プラグインを使用できません。設定ファイルを修正してから、エクスプローラーの「一覧を更新」（↻）を押してください。", canAdd: false };
    case "project":
      return count
        ? { text: `プロジェクト「${place.projectName}」に追加されているプラグインです。チェックルールの結果は、テキストの下の問題一覧に表示されます。`, canAdd: true }
        : { text: `プロジェクト「${place.projectName}」にはまだプラグインがありません。「追加…」を押して、チェックルールのプラグインのフォルダを選んでください。`, canAdd: true };
  }
}

/** 種類ごとの、追加できないことを伝える言葉。 */
const RUNTIME_WORDS: Record<Exclude<PluginRuntime, "rules">, string> = {
  browser: "画面に機能を追加するプラグイン（TypeScript）",
  "wasm-component": "WebAssembly で動くプラグイン",
};

/** 「追加」の確認ダイアログの中身。 */
export interface AddPrompt {
  text: string;
  /** 押すと追加するボタンの文言。 */
  confirm: string;
  /** プロジェクトの名前を尋ねるか（まだプロジェクトでないフォルダ）。 */
  askName: boolean;
}

/**
 * 選んだプラグインを「このプロジェクト」に追加する前に示す、確認の中身を作る。チェックルールのプラグイン以外は、まだ追加できないと伝える。
 *
 * @param info マニフェストから読んだ、プラグインの情報
 * @param project 今のプロジェクトの設定。まだプロジェクトでないフォルダなら null
 * @param installed 同じ ID のプラグインが、すでに追加されているか
 * @returns 確認の中身。追加できない種類なら `{ refused: 理由の文 }`
 * @example
 * addPrompt({ id: "jp.x", name: "トレーサビリティのチェック", version: "0.1.0", runtime: "rules" }, { plugins: {} }, false)
 * // → { text: "「トレーサビリティのチェック」（ID：jp.x、バージョン 0.1.0）をこのプロジェクトに追加します。チェックルールのプラグインです。…", confirm: "追加する", askName: false }
 * addPrompt({ …, runtime: "rules" }, null, false) // → { …, confirm: "プロジェクトにして追加", askName: true }
 * addPrompt({ name: "書き出し", runtime: "browser", … }, …) // → { refused: "「書き出し」は、画面に機能を追加するプラグイン（TypeScript）です。この種類はまだ追加できません。…" }
 */
export function addPrompt(info: PluginInfo, project: ProjectFile | null, installed: boolean): AddPrompt | { refused: string } {
  if (info.runtime !== "rules") {
    return { refused: `「${info.name}」は、${RUNTIME_WORDS[info.runtime]}です。この種類はまだ追加できません。現在追加できるのは、チェックルールのプラグインだけです` };
  }
  const wanted = project?.plugins[info.id]?.version;
  const parts = [
    `「${info.name}」（ID：${info.id}、バージョン ${info.version}）をこのプロジェクトに追加します。`,
    info.description ? `説明：${info.description}` : "",
    "チェックルールのプラグインです。モデルのルールを記述したもので、プログラムは含みません。",
    `プラグインのファイルを ${PLUGINS_DIR}/${info.id}/ にコピーし、プロジェクトの設定（modelith.json）に登録します。Git で共有すると、チームの全員と CI が同じプラグインを使えます。`,
    installed ? "追加済みのプラグインは上書きされます。" : "",
    wanted && wanted !== info.version ? `プロジェクトの設定ではバージョン ${wanted} が指定されています。追加すると、設定のバージョンを ${info.version} に変更します。` : "",
    project ? "" : "このフォルダはまだプロジェクトではないため、プロジェクトにします（設定ファイル modelith.json をフォルダの直下に作成します）。プロジェクト名を入力してください。",
  ];
  return { text: parts.filter(Boolean).join(""), confirm: project ? "追加する" : "プロジェクトにして追加", askName: !project };
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
