// v1 のプラグインの、一覧とメニューに出す言葉と項目（ADR-0018 §3）。入出力を持たない。

import type { Command, Exporter, Importer, Permission } from "./generated/protocol";
import { acceptOf } from "./transfer";

/** 動かす v1 のプラグイン 1 つ（プロジェクトかこのブラウザに入れ、有効で、読み込みの問題が無いもの）。 */
export interface ScriptPlugin {
  id: string;
  name: string;
  version: string;
  /** 作者の名前（マニフェストに書いてあれば）。 */
  author?: string;
  permissions: Permission[];
  commands: Command[];
  importers: Importer[];
  exporters: Exporter[];
  /** プログラムのファイル（1 つにまとめた従来型のスクリプト）の中身。 */
  code: string;
  /** プロジェクトの設定（modelith.json の plugins.<id>.settings）。 */
  settings?: unknown;
}

/** 動かしているプラグインの状態。 */
export type RunState = "checking" | "asking" | "starting" | "running" | "stopped" | "failed" | "denied";

/** 状態の画面の言葉。止めたときは「止まった」と言い切らない（Chromium では数秒動き続けるため。ADR-0018 §3.1）。 */
export const RUN_STATE_LABEL: Record<RunState, string> = {
  checking: "確認中",
  asking: "許可の確認中",
  starting: "起動中",
  running: "実行中",
  stopped: "停止",
  failed: "エラーあり",
  denied: "許可されていません",
};

/** メニューに出す項目 1 つ（コマンド・インポート・エクスポート）。 */
export interface CommandItem {
  plugin: string;
  /** コマンド・インポート・エクスポートの ID。 */
  command: string;
  /** メニューに出す名前（コマンドの表示名）。 */
  label: string;
  /** マウスを乗せたときに出す説明（どのプラグインのコマンドか）。 */
  tooltip: string;
}

/**
 * 動いているプラグインのコマンドを、メニューの項目にする（プラグインの順、コマンドはマニフェストの順）。
 *
 * @param plugins プラグインの ID・名前・状態・コマンド
 * @returns メニューの項目。実行中（準備ができた）のプラグインのものだけ
 * @example
 * commandItems([{ id: "jp.x", name: "要求の ID の補完", state: "running", commands: [{ id: "fill", title: "要求に ID を付ける" }] }])
 * // → [{ plugin: "jp.x", command: "fill", label: "要求に ID を付ける", tooltip: "プラグイン「要求の ID の補完」のコマンド" }]
 * commandItems([{ …, state: "starting", … }]) // → []（まだ準備ができていない）
 */
export function commandItems(plugins: readonly { id: string; name: string; state: RunState; commands: readonly Command[] }[]): CommandItem[] {
  return plugins
    .filter((p) => p.state === "running")
    .flatMap((p) => p.commands.map((c) => ({ plugin: p.id, command: c.id, label: c.title, tooltip: `プラグイン「${p.name}」のコマンド` })));
}

/**
 * 止める操作をしたことを知らせる文（止まったとは言い切らない）。
 *
 * @param name プラグインの名前
 * @returns 知らせの文
 * @example
 * stopNotice("要求の ID の補完") // → "プラグイン「要求の ID の補完」に停止を指示しました。完全に止まるまで数秒かかることがあります"
 */
export function stopNotice(name: string): string {
  return `プラグイン「${name}」に停止を指示しました。完全に止まるまで数秒かかることがあります`;
}

/** メニューの項目を作るために要る、動かしているプラグインの情報。 */
type MenuPlugin = Pick<ScriptPlugin, "id" | "name" | "importers" | "exporters"> & { state: RunState };

/**
 * 動いているプラグインのインポートを、メニューの「プラグインでインポート」の項目にする（F-PLUG-4）。
 *
 * @param plugins プラグインの ID・名前・状態・インポート
 * @returns メニューの項目と、ファイルを選ぶときの絞り込み（accept）。実行中のプラグインのものだけ
 * @example
 * importItems([{ id: "jp.x", name: "ReqIF のインポート", state: "running", importers: [{ id: "reqif", label: "ReqIF ファイル", extensions: [".reqif"] }], exporters: [] }])
 * // → [{ plugin: "jp.x", command: "reqif", label: "ReqIF ファイル…", tooltip: "プラグイン「ReqIF のインポート」で、ファイル（.reqif）をインポートして新しいファイルとして開きます", accept: ".reqif" }]
 * importItems([{ …, state: "stopped", … }]) // → []
 */
export function importItems(plugins: readonly MenuPlugin[]): (CommandItem & { accept: string })[] {
  return plugins
    .filter((p) => p.state === "running")
    .flatMap((p) =>
      p.importers.map((i) => {
        const accept = acceptOf(i.extensions);
        return { plugin: p.id, command: i.id, label: `${i.label}…`, tooltip: `プラグイン「${p.name}」で、ファイル（${accept || "すべて"}）をインポートして新しいファイルとして開きます`, accept };
      }),
    );
}

/**
 * 動いているプラグインのエクスポートを、メニューの「プラグインでエクスポート」の項目にする（F-PLUG-4）。
 *
 * @param plugins プラグインの ID・名前・状態・エクスポート
 * @returns メニューの項目。実行中のプラグインのものだけ
 * @example
 * exportItems([{ id: "jp.x", name: "表のエクスポート", state: "running", importers: [], exporters: [{ id: "csv", label: "要求の表（CSV）", extension: ".csv" }] }])
 * // → [{ plugin: "jp.x", command: "csv", label: "要求の表（CSV）", tooltip: "プラグイン「表のエクスポート」で、モデル（作成した図を表示中なら、その図）を .csv のファイルにエクスポートしてダウンロードします" }]
 * exportItems([]) // → []
 */
export function exportItems(plugins: readonly MenuPlugin[]): CommandItem[] {
  return plugins
    .filter((p) => p.state === "running")
    .flatMap((p) =>
      p.exporters.map((x) => ({ plugin: p.id, command: x.id, label: x.label, tooltip: `プラグイン「${p.name}」で、モデル（作成した図を表示中なら、その図）を ${x.extension} のファイルにエクスポートしてダウンロードします` })),
    );
}
