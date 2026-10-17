# 検査ルール（v0 のプラグイン）

モデルが組織の決まりを守っているかを、YAML に書いたルールで検査する（[ADR-0018](../adr/0018-plugin-host.md) §2）。
ルールはコードを含まない。解釈は Modelith のコア（Rust）だけが行うので、画面と CLI（`modelith check`）で結果は同じになる。

ルールの形の定義元は plugin-sdk（`modelith-plugin-protocol` の `RuleSet`）で、JSON Schema は plugin-sdk の `schema/rule-set.schema.json`。

## プラグインの置き方

プロジェクト（[ADR-0019](../adr/0019-projects.md)）のフォルダに、次のように置く。

```
my-project/
  modelith.json
  model.sysml
  .modelith/
    plugins/
      jp.example.trace/
        manifest.json
        rules.yaml
```

`modelith.json`：使うプラグインを ID で書く。`enabled` が `false` のものは読まない（書かなければ有効）。

```json
{
  "name": "給水システム",
  "plugins": {
    "jp.example.trace": { "version": "0.1.0", "enabled": true }
  }
}
```

`.modelith/plugins/<ID>/manifest.json`：プラグインのマニフェスト。`runtime` は `rules`、`apiVersion` は `"0"`。
`contributes.rules` に、ルールのファイルを**プラグインのフォルダからの相対パス**で並べる（フォルダの外は指せない）。

```json
{
  "id": "jp.example.trace",
  "name": "トレースの検査",
  "version": "0.1.0",
  "apiVersion": "0",
  "runtime": "rules",
  "license": "MIT",
  "contributes": { "rules": ["rules.yaml"] }
}
```

`rules.yaml`：

```yaml
rules:
  - id: req-has-satisfier          # プラグインの中で一意（英小文字・数字・-）
    severity: error                # error / warning / information / hint
    message: "要求「{name}」を満たす要素がありません"
    match:                         # どの要素に当てるか（書いたものすべてを満たす要素）
      kind: requirement def        # 要素の種類（1 つか並び）
      phase: SystemRequirements    # 任意。工程（@Phase の stage）の名前
      name: "^[A-Z]"               # 任意。名前の正規表現
    require:                       # 満たすべき条件（書いたものすべて）
      incoming: satisfy            # この種類の関係を、ほかの要素から 1 本以上受ける
  - id: part-has-ports
    severity: warning
    message: "{kind}「{name}」にポートがありません"
    match:
      kind: [part def, part]
    require:
      ports: { min: 1 }
```

## ルールの項目

| 項目 | 必須 | 意味 |
| --- | --- | --- |
| `id` | ○ | ルールの ID。プラグインの中で一意。英小文字・数字・`-`（英小文字か数字で始める） |
| `severity` | ○ | 重さ。`error`（誤り）・`warning`（注意）・`information`（情報）・`hint`（ヒント） |
| `message` | ○ | 結果の文。`{name}` に要素の名前、`{kind}` に要素の種類（下の表の言葉）を差し込む |
| `match.kind` | ○ | 当てる要素の種類。1 つか並び（並びはいずれか） |
| `match.phase` | | 工程の名前が等しい要素だけに当てる |
| `match.name` | | 名前が正規表現に当たる要素だけに当てる |
| `require.incoming` | | この種類の関係を 1 本以上受ける。1 つか並び（並びはいずれか） |
| `require.outgoing` | | この種類の関係を 1 本以上出す。1 つか並び |
| `require.name` | | 名前が正規表現に当たる |
| `require.phase` | | `true` なら工程を持つ、`false` なら持たない |
| `require.ports` | | ポートの数が `min` 以上 `max` 以下（両端を含む。省いた側は制限しない） |
| `require.not` | | 中に書いた条件（`require` と同じ形）を満たさない |

- `require` に何も書かなければ、いつも満たす（結果は出ない）。`not: {}` はいつも満たさないので、`match` に当たった要素すべてに結果を出す。
- 正規表現は [regex-lite](https://docs.rs/regex-lite) の書き方。名前のどこかに当たればよい（全体に当てるときは `^…$`）。`\w`・`\d` などは ASCII の文字だけに当たる。
- 工程は、要素か、それを囲む要素に付けた `@Phase { stage = …; }` の値。
- 知らない項目・知らない種類・誤った正規表現などは、黙って捨てず、ファイルと行・列を添えて誤りとして知らせる。そのルールは使わない。

## 要素の種類（`match.kind`）

図に描く要素の種類を書く。

| 書く言葉 | 画面の言葉 |
| --- | --- |
| `part def` | 部品定義 |
| `part` | 部品（package の直下にあるものだけ。部品の中の部品は要素にならない） |
| `requirement def` | 要求 |
| `requirement` | 要求（package の直下にあるものだけ） |
| `concern def` | 関心事 |
| `verification def` | 検証 |
| `occurrence def` | シナリオ |
| `port def`・`item def`・`attribute def`・`enum def` | ポート・項目・属性・列挙の定義 |
| `action def`・`state def`・`use case def` | 動作・状態・ユースケースの定義 |
| `constraint def`・`calc def`・`analysis def` | 制約・計算・解析の定義 |
| `interface def`・`connection def` | インタフェース・接続の定義 |

メタデータの定義（`metadata def`）とビューの定義（`view def`）は、要素にならないので書けない。

## 関係の種類（`require.incoming`・`require.outgoing`）

向きは「元 → 先」。`incoming` は先の側、`outgoing` は元の側で数える。

| 書く言葉 | 画面の言葉 | 元 → 先 |
| --- | --- | --- |
| `satisfy` | 満たす | 満たす要素 → 要求 |
| `verify` | 検証する | 検証 → 要求 |
| `frame` | 扱う | 扱う要素 → 関心事 |
| `derivation` | 導出 | 導出した（下位の）要求 → 導出元の（上位の）要求 |
| `flow` | 流れ | 流れの元 → 先（`connect` による接続も含む。部品の型どうしを結ぶ） |

例：「要求を満たす要素がある」は `incoming: satisfy`、「上位の要求から導出している」は `outgoing: derivation`、「下位の要求に展開している」は `incoming: derivation`。

## CLI で検査する

```
modelith check <プロジェクトのフォルダ>
```

- `modelith.json` を読み、有効なプラグインのルールで、フォルダの中の `.sysml`・`.kerml` を検査する。隠しフォルダ（`.modelith` を含む）・`target`・`node_modules` の中は見ない。
- 結果を 1 件 1 行で、パス・行・列の順に出し、最後にまとめを 1 行出す。行と列は 1 から数える（列は UTF-16 の単位）。

  ```
  model.sysml:3:3: 誤り: 要求「KeepPressure」を満たす要素がありません [jp.example.trace/req-has-satisfier]
  model.sysml:5:3: 注意: part def「Tank」にポートがありません [jp.example.trace/part-has-ports]
  ファイル 1 件を検査しました：誤り 1 件・注意 1 件・情報 0 件・ヒント 0 件
  ```

- ルールやマニフェストの誤り、`modelith.json` に書いてあるのに入っていないプラグインも、誤りとして同じ形で出す（末尾の `[…]` はプラグインの ID）。

| 終了コード | 意味 |
| --- | --- |
| 0 | 誤り（`error`）が無い（注意・情報だけはこちら） |
| 1 | 誤りが 1 件以上ある。またはフォルダ・`modelith.json` を読めない |
| 2 | 使い方の誤り |
