# reference/

Rust 実装の「動く仕様書」（ADR-0002）。

| パス | 内容 |
| --- | --- |
| `mock/Modelith.html` | 凍結した JS モック。**ファイルは非公開のためコミットしない**（`.gitignore` 済み）。メンテナが手元に置く。コードの移植は ADR-0009 |
| `golden/cases/*.sysml` | ゴールデンの入力ケース。公開してよい内容だけを置く |
| `golden/*.json` | モックのパーサ・モデル構築の出力。生成物なので手で編集しない |
| `tools/gen-golden.mjs` | ゴールデンの生成・検証スクリプト |

```bash
node reference/tools/gen-golden.mjs          # 再生成
node reference/tools/gen-golden.mjs --check  # 最新か検証（scripts/check.sh が実行）
```

モックが手元に無い環境（CI や外部の貢献者）では生成・検証はスキップされ、コミット済みのゴールデン JSON だけが仕様になる。
ケースを追加・モックを更新したら、モックを持つメンテナが再生成してコミットする。
