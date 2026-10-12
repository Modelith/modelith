# modelith
SysML v2 / KerML modeling editor with synchronized text and diagram editing

Rust のコアをブラウザ（WebAssembly）・CLI・サーバで共有し、プラグインで拡張できる SysML v2 エディタです。

- アーキテクチャ: [docs/explanation/architecture.md](docs/explanation/architecture.md)
- 設計判断（ADR）: [docs/adr/](docs/adr/)

## Development

- ブランチ戦略: [docs/development/branching-strategy.md](docs/development/branching-strategy.md)
- コントリビュート（CLA）: [CONTRIBUTING.md](CONTRIBUTING.md)
- エージェント向けガイド: [CLAUDE.md](CLAUDE.md)
- 完了前チェック: `scripts/check.sh`

## License

[AGPL-3.0](LICENSE) with the [Modelith Plugin Exception](PLUGIN-EXCEPTION.md).
Plugin interfaces ([plugin-sdk](https://github.com/modelith/plugin-sdk)) are MIT licensed.
