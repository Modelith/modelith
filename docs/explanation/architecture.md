# アーキテクチャ概要

```
                 ┌───────────────────────────────────────────┐
                 │ modelith-core（Rust）                      │
                 │ パーサ(CST)・モデル・検査・YAMLルール・TextEdit │
                 └───────┬──────────────┬──────────────┬──────┘
                         │              │              │
          ┌──────────────▼───┐  ┌───────▼────────┐  ┌──▼──────────────────┐
          │ ブラウザ           │  │ サーバ（axum）   │  │ CLI / LSP / MCP      │
          │ modelith-wasm     │  │ Git 保管・認証   │  │ CI での検査           │
          │ ＋ web/（TS UI）   │  │ SysML v2 API     │  │ エディタ支援           │
          └──────────────────┘  └────────────────┘  └─────────────────────┘
```

## リポジトリ内の配置

| パス | 内容 | 段階 |
| --- | --- | --- |
| `crates/modelith-core` | コア | P1 |
| `crates/modelith-wasm` | ブラウザ向け wasm バインディング | P2 |
| `crates/modelith-cli` | `modelith` コマンド（check / export / MCP） | P3 |
| `crates/modelith-lsp` | LSP サーバ（未作成） | P5 |
| `crates/modelith-server` | サーバ（未作成） | P6 |
| `web/` | ウェブアプリ（TypeScript + Vite） | P2 |
| `reference/` | 凍結したモックとゴールデン（ADR-0002） | P0 |

プラグインとの契約は別リポジトリ [`modelith/plugin-sdk`](https://github.com/modelith/plugin-sdk) にある（ADR-0004）。

## ロードマップ

| 段階 | 内容 |
| --- | --- |
| P0 | モノレポの骨組み・ハーネス・ADR（完了） |
| P1 | Rust コア：CST パーサ、モデル、TextEdit 生成。ゴールデンでモックと一致させる |
| P2 | wasm 化し、モックの UI を TS へ移植してコアを呼ぶ |
| P3 | CLI（check / export）と MCP（stdio） |
| P4 | プラグイン v0（YAML ルール）→ v1（TS） |
| P5 | LSP |
| P6 | サーバ（Git 保管・認証・SysML v2 標準 API）、プラグイン v2（WASM Component） |
