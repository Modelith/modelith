/// <reference types="vite/client" />

/** package.json の version（vite.config.ts で埋め込む）。 */
declare const __APP_VERSION__: string;
/** ビルドしたコミットの SHA（取得できなければ空文字列）。 */
declare const __APP_COMMIT__: string;
