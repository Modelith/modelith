/// <reference types="vite/client" />

/** package.json の version（vite.config.ts で埋め込む）。 */
declare const __APP_VERSION__: string;
/** ビルドしたコミットの SHA（取得できなければ空文字列）。 */
declare const __APP_COMMIT__: string;
/** 著作権表示（vite.config.ts で埋め込む）。 */
declare const __APP_COPYRIGHT__: string;
/** 公開の系列（`stable`：安定版、`preview`：プレリリース版。vite.config.ts で MODELITH_CHANNEL から埋め込む。ADR-0020）。 */
declare const __APP_CHANNEL__: string;
