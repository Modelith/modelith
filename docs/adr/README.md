# Architecture Decision Records

設計上の重要な判断を 1 件 1 ファイルで記録する。新しい判断は `NNNN-<slug>.md` を追加し、
過去の ADR を覆す場合は旧 ADR の状態を「置き換え済み（ADR-XXXX）」に更新する。

| ADR | タイトル | 状態 |
| --- | --- | --- |
| [0001](0001-text-is-source-of-truth.md) | テキストが唯一の正本 | 採用 |
| [0002](0002-rust-core-and-golden-tests.md) | Rust コアの共有とモックのゴールデン化 | 採用（一部 ADR-0009・ADR-0013 で改訂） |
| [0003](0003-web-app-host.md) | ウェブアプリを本体とし、コアは Worker 内 wasm で動かす | 採用 |
| [0004](0004-plugin-architecture.md) | プラグインの構成と段階的導入 | 採用 |
| [0005](0005-diagram-layout-storage.md) | 図の中身は標準の view で表し、配置はモデルごとの別ファイルに保存する | 採用（2026-10-13 改訂） |
| [0006](0006-licensing.md) | ライセンス：AGPL＋プラグイン例外＋CLA | 採用 |
| [0007](0007-dev-integration-branch.md) | dev 統合ブランチとマイルストーン単位のリリース | 採用 |
| [0008](0008-principles-as-harness.md) | プログラミング原則・テスト原則のスキル化とハーネスでの強制 | 採用 |
| [0009](0009-port-mock-for-public-alpha.md) | モックのコードを移植して最初の alpha を公開する | 採用 |
| [0010](0010-file-providers.md) | ファイル操作をストレージごとのプロバイダに分け、ワークスペースが束ねる | 採用 |
| [0011](0011-requirements-ssot.md) | 要求仕様を 1 つの SysML v2 ファイルで管理する | 採用 |
| [0012](0012-google-drive-without-server.md) | クラウド保存は Google ドライブから始め、サーバを持たずにブラウザから直接つなぐ | 保留 |
| [0013](0013-spec-over-mock.md) | モックと SysML v2 仕様が食い違うときは仕様に従う | 採用 |
| [0014](0014-plain-words-for-users.md) | 画面の言葉は、SysML v2 の構文を知らない人に合わせる | 採用 |
