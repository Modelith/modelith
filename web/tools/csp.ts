// Content-Security-Policy（C-9）。ビルドした index.html に <meta> として差し込む。
// GitHub Pages は応答ヘッダを設定できないので、<meta http-equiv> で付ける（frame-ancestors など、meta で効かない指示は書かない）。
// 開発サーバ（vite dev）は HMR の WebSocket を使うので付けない。e2e はビルドした静的ファイルを配信して動かすので、そこで効き目を確かめる。
import type { Plugin } from "vite";

/**
 * 画面に付ける Content-Security-Policy の指示。
 * - default-src 'self'：既定は配信元だけ（画像・フォント・wasm の取得・iframe のページを含む）
 * - script-src：配信元のスクリプトと wasm だけ。インラインのスクリプトと eval は許さない（エスケープ漏れの保険）
 * - style-src：同梱の CSS と、要素の style 属性（図やエクスプローラーが style="--d:0" のような値を書く）
 * - img-src：favicon は data: の SVG
 * - worker-src：コアの Worker は配信元のファイル
 * - object-src 'none'・base-uri 'none'・form-action 'none'：使わないものは閉じる
 */
const DIRECTIVES: ReadonlyArray<readonly [string, string]> = [
  ["default-src", "'self'"],
  ["script-src", "'self' 'wasm-unsafe-eval'"],
  ["style-src", "'self' 'unsafe-inline'"],
  ["img-src", "'self' data:"],
  ["font-src", "'self'"],
  ["connect-src", "'self'"],
  ["worker-src", "'self'"],
  ["frame-src", "'self'"],
  ["object-src", "'none'"],
  ["base-uri", "'none'"],
  ["form-action", "'none'"],
];

/**
 * Content-Security-Policy の値を組み立てる。
 *
 * @returns `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; …` の形の 1 行
 * @example
 * contentSecurityPolicy() // → "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; …"
 */
export function contentSecurityPolicy(): string {
  return DIRECTIVES.map(([name, value]) => `${name} ${value}`).join("; ");
}

/**
 * ビルドした HTML の <head> の先頭（charset の直後）に、Content-Security-Policy の <meta> を差し込む。
 * charset より前に置くと、文字コードの判定より先に CSP が読まれるので、charset の後に置く。
 *
 * @param html index.html の中身
 * @param policy 差し込むポリシー（既定は contentSecurityPolicy()）
 * @returns <meta http-equiv="Content-Security-Policy"> を足した HTML。charset の <meta> が無ければ <head> の直後に足す
 * @example
 * injectCsp('<head>\n<meta charset="utf-8">\n<title>x</title>', "default-src 'self'")
 * // → '<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n<title>x</title>'
 */
export function injectCsp(html: string, policy: string = contentSecurityPolicy()): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const charset = /<meta charset="[^"]*">/.exec(html);
  if (charset) return `${html.slice(0, charset.index + charset[0].length)}\n${meta}${html.slice(charset.index + charset[0].length)}`;
  return html.replace(/<head>/, `<head>\n${meta}`);
}

/**
 * ビルドのときだけ index.html に CSP を差し込む Vite プラグイン（vite dev には付けない。HMR の WebSocket が CSP に引っかかるため）。
 *
 * @returns Vite プラグイン
 * @example
 * defineConfig({ plugins: [cspPlugin()] })
 */
export function cspPlugin(): Plugin {
  return {
    name: "modelith-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => injectCsp(html),
    },
  };
}
