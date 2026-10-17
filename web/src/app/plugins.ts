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
  ok: "使える",
  error: "誤りあり",
  missing: "入っていない",
  version: "版が違う",
  off: "止めている",
};

/** プラグインの一覧の 1 行。 */
export interface PluginRow {
  id: string;
  /** 画面に出す名前（マニフェストの名前。読めなければ ID）。 */
  name: string;
  /** 入っている版（マニフェストの版）。入っていない・読めなければ null。 */
  version: string | null;
  /** プロジェクトの設定（modelith.json）に書かれた版。書いていなければ null。 */
  wanted: string | null;
  enabled: boolean;
  state: PluginState;
  /** 使えるルールの数。 */
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
 * プロジェクトが使うプラグイン 1 つの状態を決める。止めている → 入っていない → 版が違う → 誤りあり → 使える、の順に見る。
 *
 * @param use modelith.json に書かれた、そのプラグインの設定
 * @param summary コアが読み込んだまとめ（まだ読み込んでいなければ undefined。入っていないとみなす）
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
 * loadProblemText({ path: ".modelith/plugins/jp.x/rules.yaml", place: { line: 3, column: 5 }, message: "知らない項目「x」があります（…）" })
 * // → ".modelith/plugins/jp.x/rules.yaml の 3 行目：知らない項目「x」があります（…）"
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
 * pluginRows({ plugins: { "jp.x": { version: "0.1.0", enabled: true } } }, [{ id: "jp.x", installed: true, manifest: { name: "トレース", version: "0.1.0", … }, rules: 2, problems: [] }])
 * // → [{ id: "jp.x", name: "トレース", version: "0.1.0", wanted: "0.1.0", enabled: true, state: "ok", rules: 2, problems: [] }]
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
 * 入っていない・版が違うプラグインについて、何が足りないかと、追加するかを尋ねる文を作る（F-PLUG-9）。
 *
 * @param row 一覧の行
 * @returns 案内の文。止めている・入っていて版も合うなら null
 * @example
 * missingNotice({ id: "jp.x", state: "missing", … })
 * // → "このプロジェクトはプラグイン「jp.x」を使っていますが、入っていません。追加しますか？"
 * missingNotice({ name: "トレース", state: "version", wanted: "0.2.0", version: "0.1.0", … })
 * // → "このプロジェクトはプラグイン「トレース」の版 0.2.0 を使っていますが、入っているのは版 0.1.0 です。合う版を追加しますか？"
 * missingNotice({ state: "ok", … }) // → null
 */
export function missingNotice(row: PluginRow): string | null {
  if (row.state === "missing") return `このプロジェクトはプラグイン「${row.id}」を使っていますが、入っていません。追加しますか？`;
  if (row.state === "version") {
    return `このプロジェクトはプラグイン「${row.name}」の版 ${row.wanted ?? ""} を使っていますが、入っているのは版 ${row.version ?? ""} です。合う版を追加しますか？`;
  }
  return null;
}

/**
 * 問題一覧に出す、プラグインについての行を作る。使うプラグインだけを見る（止めたものは出さない）。
 * 足りないプラグインは追加を尋ねる行（押すと追加を始める）、読み込みの問題はプラグインの名前とファイル・行を添えた行にする（F-PLUG-3・F-PLUG-9）。
 *
 * @param rows 一覧の行
 * @returns 問題一覧の行（一覧の順）
 * @example
 * pluginNotes([{ id: "jp.x", state: "missing", enabled: true, … }])
 * // → [{ msg: "このプロジェクトはプラグイン「jp.x」を使っていますが、入っていません。追加しますか？", add: "jp.x" }]
 * pluginNotes([{ name: "トレース", state: "error", enabled: true, problems: ["….yaml の 3 行目：…"], … }])
 * // → [{ msg: "プラグイン「トレース」：….yaml の 3 行目：…" }]
 * pluginNotes([{ state: "off", … }]) // → []
 */
export function pluginNotes(rows: readonly PluginRow[]): PluginNote[] {
  return rows.flatMap((row) => {
    if (!row.enabled) return [];
    const notice = missingNotice(row);
    // 入っていないプラグインの「マニフェストが見つからない」は、追加を尋ねる行と同じことなので重ねない
    const problems = row.state === "missing" ? [] : row.problems.map((p) => ({ msg: `プラグイン「${row.name}」：${p}` }));
    return notice ? [{ msg: notice, add: row.id }, ...problems] : problems;
  });
}

/**
 * 検査ルールの結果を、問題一覧に出す文にする。どのプラグインのどのルールかを添える（F-PLUG-1）。
 *
 * @param f 検査ルールの結果
 * @param names プラグインの ID → 画面に出す名前（無ければ ID を出す）
 * @returns 「結果の文（プラグイン「名前」のルール ID）」
 * @example
 * findingText({ plugin: "jp.x", rule: "req-sat", message: "要求「R」を満たす要素がありません", … }, new Map([["jp.x", "トレースの検査"]]))
 * // → "要求「R」を満たす要素がありません（プラグイン「トレースの検査」のルール req-sat）"
 * findingText({ plugin: "jp.y", rule: "r1", message: "m", … }, new Map()) // → "m（プラグイン「jp.y」のルール r1）"
 */
export function findingText(f: RuleFinding, names: ReadonlyMap<string, string>): string {
  return `${f.message}（プラグイン「${names.get(f.plugin) ?? f.plugin}」のルール ${f.rule}）`;
}

/** 検査ルールの結果の重さごとの印（問題一覧の行の頭）。 */
export const SEVERITY_MARK: Record<RuleSeverity, string> = { error: "⚠", warning: "△", information: "ℹ", hint: "ℹ" };

/** プラグインの一覧の画面が置かれた場面。 */
export type PanelPlace =
  | { kind: "unsupported" }
  | { kind: "noFolder" }
  | { kind: "folder"; folderName: string }
  | { kind: "brokenProject" }
  | { kind: "project"; projectName: string };

/**
 * プラグインの一覧の画面の、最初の案内と「追加」を押せるかを決める。プロジェクトが無ければ、プロジェクトに入れて使うことと、その作り方を示す。
 *
 * @param place 場面（フォルダを開けないブラウザ・フォルダ無し・プロジェクトでないフォルダ・読めない設定・プロジェクト）
 * @param count 使うプラグインの数（プロジェクトのとき）
 * @returns 案内の文と、「追加」を押せるか
 * @example
 * panelIntro({ kind: "noFolder" }, 0)                 // → { text: "プラグインは、プロジェクト（モデルのフォルダ）に入れて使います。…", canAdd: false }
 * panelIntro({ kind: "project", projectName: "給水" }, 0) // → { text: "プロジェクト「給水」には、まだプラグインがありません。…", canAdd: true }
 */
export function panelIntro(place: PanelPlace, count: number): { text: string; canAdd: boolean } {
  switch (place.kind) {
    case "unsupported":
      return { text: "このブラウザではフォルダを開けないため、プラグインを使えません（Chrome・Edge で使えます）。プラグインは、プロジェクト（モデルのフォルダ）に入れて使います。", canAdd: false };
    case "noFolder":
      return {
        text: "プラグインは、プロジェクト（モデルのフォルダ）に入れて使います。「ファイル → フォルダを開く…」でモデルのフォルダを開くと、追加できます。1 つだけ開いたファイルやサンプルには入れられません。",
        canAdd: false,
      };
    case "folder":
      return {
        text: `フォルダ「${place.folderName}」は、まだプロジェクトではありません。「追加…」でプラグインのフォルダを選ぶと、このフォルダをプロジェクトにしてから入れます（設定ファイル modelith.json を作ります）。`,
        canAdd: true,
      };
    case "brokenProject":
      return { text: "プロジェクトの設定（modelith.json）に誤りがあるため、プラグインを使えません。設定ファイルを直してから、エクスプローラーの「一覧を更新」（↻）を押してください。", canAdd: false };
    case "project":
      return count
        ? { text: `プロジェクト「${place.projectName}」に入れたプラグインです。検査ルールの結果は、テキストの下の問題一覧に出ます。`, canAdd: true }
        : { text: `プロジェクト「${place.projectName}」には、まだプラグインがありません。「追加…」で、検査ルールのプラグインのフォルダを選んでください。`, canAdd: true };
  }
}

/** 種類ごとの、追加できないことを伝える言葉。 */
const RUNTIME_WORDS: Record<Exclude<PluginRuntime, "rules">, string> = {
  browser: "画面に機能を足すプラグイン（TypeScript）",
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
 * 選んだプラグインを「このプロジェクト」に追加する前に示す、確認の中身を作る。検査ルールのプラグイン以外は、まだ追加できないと伝える。
 *
 * @param info マニフェストから読んだ、プラグインの情報
 * @param project 今のプロジェクトの設定。まだプロジェクトでないフォルダなら null
 * @param installed 同じ ID のプラグインが、すでに入っているか
 * @returns 確認の中身。追加できない種類なら `{ refused: 理由の文 }`
 * @example
 * addPrompt({ id: "jp.x", name: "トレース", version: "0.1.0", runtime: "rules" }, { plugins: {} }, false)
 * // → { text: "「トレース」（ID：jp.x、版 0.1.0）を、このプロジェクトに追加します。検査ルールのプラグインです。…", confirm: "追加する", askName: false }
 * addPrompt({ …, runtime: "rules" }, null, false) // → { …, confirm: "プロジェクトにして追加", askName: true }
 * addPrompt({ name: "書き出し", runtime: "browser", … }, …) // → { refused: "「書き出し」は、画面に機能を足すプラグイン（TypeScript）です。この種類は、まだ追加できません。…" }
 */
export function addPrompt(info: PluginInfo, project: ProjectFile | null, installed: boolean): AddPrompt | { refused: string } {
  if (info.runtime !== "rules") {
    return { refused: `「${info.name}」は、${RUNTIME_WORDS[info.runtime]}です。この種類は、まだ追加できません。今追加できるのは、検査ルールのプラグインだけです` };
  }
  const wanted = project?.plugins[info.id]?.version;
  const parts = [
    `「${info.name}」（ID：${info.id}、版 ${info.version}）を、このプロジェクトに追加します。`,
    info.description ? `説明：${info.description}` : "",
    "検査ルールのプラグインです。モデルの決まりを書いたもので、プログラムは含みません。",
    `プラグインのファイルを ${PLUGINS_DIR}/${info.id}/ に写し、プロジェクトの設定（modelith.json）に書き加えます。Git で共有すると、チームの全員と CI が同じプラグインを使えます。`,
    installed ? "すでに入っているものは、置き換えます。" : "",
    wanted && wanted !== info.version ? `プロジェクトの設定では版 ${wanted} を使うことになっています。追加すると、設定の版を ${info.version} に書き換えます。` : "",
    project ? "" : "このフォルダはまだプロジェクトではないため、プロジェクトにします（設定ファイル modelith.json をフォルダの一番上に作ります）。プロジェクトの名前を入力してください。",
  ];
  return { text: parts.filter(Boolean).join(""), confirm: project ? "追加する" : "プロジェクトにして追加", askName: !project };
}

/**
 * 選んだプラグインのフォルダのファイルを、プロジェクトの中の置き場所（`.modelith/plugins/<ID>/…`）に写す計画にする。
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
