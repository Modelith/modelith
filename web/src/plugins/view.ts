// v1 のプラグインの、一覧とメニューに出す言葉と項目（ADR-0018 §3）。入出力を持たない。

import type { Command, Permission } from "./generated/protocol";

/** 動かす v1 のプラグイン 1 つ（プロジェクトに入れ、有効で、読み込みの問題が無いもの）。 */
export interface ScriptPlugin {
  id: string;
  name: string;
  version: string;
  permissions: Permission[];
  commands: Command[];
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

/** メニューに出すコマンド 1 つ。 */
export interface CommandItem {
  plugin: string;
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
