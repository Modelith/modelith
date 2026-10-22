// 公開の系列（安定版とプレリリース版）ごとに、ブラウザの保存領域の名前を分ける（ADR-0020）。
// 2 つの系列は同じオリジン（modelith.github.io）に置くので、名前を分けないと、新しい版が書いた形式を古い版が読んでしまう。

/**
 * 系列に合わせた保存の名前（localStorage のキー・IndexedDB のデータベース名）。安定版は名前をそのまま使い（それまでの保存を引き継ぐ）、
 * プレリリース版は後ろに `@preview` を付ける。
 *
 * @param name 保存の名前
 * @param channel 公開の系列（省くとビルドの系列 `__APP_CHANNEL__`）
 * @returns 系列ごとの名前
 * @example
 * channelName("modelith-ui-v1", "stable")  // → "modelith-ui-v1"
 * channelName("modelith-ui-v1", "preview") // → "modelith-ui-v1@preview"
 * channelName("modelith", "")              // → "modelith"（系列が無いビルド）
 */
export function channelName(name: string, channel: string = __APP_CHANNEL__): string {
  return channel === "preview" ? `${name}@preview` : name;
}
