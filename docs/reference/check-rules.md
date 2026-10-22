# チェックルール（v0 のプラグイン）

モデルが組織のルールを守っているかを、YAML に書いたルールでチェックする（[ADR-0018](../adr/0018-plugin-host.md) §2）。
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
        modelith-plugin.json
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

`.modelith/plugins/<ID>/modelith-plugin.json`：プラグインのマニフェスト。`runtime` は `rules`、`apiVersion` は `"0"`。
`contributes.rules` に、ルールのファイルを**プラグインのフォルダからの相対パス**で並べる（フォルダの外は指せない）。

```json
{
  "id": "jp.example.trace",
  "name": "トレーサビリティのチェック",
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

## 画面で使う

- 「プラグイン → プラグインの一覧…」（プロジェクトなら、エクスプローラーの「プラグイン」）で、プラグインの一覧を開く。
  名前・追加先（このプロジェクト・このブラウザ）・ID・バージョン・状態（有効・エラーあり・未追加・バージョン不一致・無効・プロジェクトを優先）・ルールの数・エラーを示し、
  「有効」の切り替えと「削除」ができる。プロジェクトのものの切り替えは `modelith.json` の `enabled` に、このブラウザのものはブラウザに保存する。
- 「追加…」でプラグインのフォルダ（`modelith-plugin.json` のあるフォルダ）を選ぶと、名前とバージョンを示し、追加先を選んでから追加する。

  | 追加先 | 置き場所 | 使える人 |
  | --- | --- | --- |
  | このプロジェクト（既定） | `.modelith/plugins/<ID>/` にコピーし、`modelith.json` に登録する。まだプロジェクトでないフォルダでは、同じ確認でプロジェクトにする（`modelith.json` を作る） | Git で共有すれば、チームの全員と CI（`modelith check`） |
  | このブラウザ | ブラウザの保存場所（IndexedDB）。フォルダを開いていなくても、フォルダを開けないブラウザ（Firefox・Safari）でも追加できる | 自分だけ。どのプロジェクトでも使える。CLI は読まない |

  フォルダを開いていない・フォルダを開けないブラウザ・`modelith.json` にエラーがあるときは、「このプロジェクト」を選べない（理由を示す）。
  フォルダを開けないブラウザでは、フォルダを選ぶ入力欄でプラグインのフォルダを選ぶ。隠しファイル・隠しフォルダ・`node_modules` は読まない（200 件まで）。
  追加できるのはチェックルールのプラグイン（`runtime: rules`）と、画面に機能を追加するプラグイン（`runtime: browser`。[TypeScript のプラグイン](script-plugins.md)）。zip ファイルからの追加は、まだ無い。
- **同じ ID のプラグインが、このプロジェクトとこのブラウザの両方にあるときは、プロジェクトのものを使う**（`modelith.json` に書いてあれば、無効・未追加でもプロジェクトの決めたことを優先する。チームと CI と同じ結果にするため）。
  このブラウザのものは一覧に「プロジェクトを優先」と示し、読み込まない。
- チェック結果は、問題一覧に「…（プラグイン「名前」のルール ID）」の形で出し、押すとその要素の行に移る。編集するとチェックし直す。
- ルールやマニフェストのエラーは、問題一覧とプラグインの一覧に、ファイルと行を添えて出す（このブラウザのものは「このブラウザの <ID>/rules.yaml」のように示す）。
- `modelith.json` にあるのに追加されていない・バージョンが違うプラグインは、エクスプローラーと問題一覧で知らせ、そこから追加できる。

## ルールの項目

| 項目 | 必須 | 意味 |
| --- | --- | --- |
| `id` | ○ | ルールの ID。プラグインの中で一意。英小文字・数字・`-`（英小文字か数字で始める） |
| `severity` | ○ | 重大度。`error`（エラー）・`warning`（警告）・`information`（情報）・`hint`（ヒント） |
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
- 不明な項目・不明な種類・正しくない正規表現などは、黙って捨てず、ファイルと行・列を添えてエラーとして知らせる。そのルールは使わない。

## 要素の種類（`match.kind`）

図に描く要素の種類を書く。

| 書く言葉 | 画面の言葉 |
| --- | --- |
| `part def` | 部品定義 |
| `part` | 部品（package の直下にあるものだけ。部品の中の部品は要素にならない） |
| `requirement def` | 要求 |
| `requirement` | 要求（package の直下にあるものだけ） |
| `verification` | 検証（package の直下にあるものだけ） |
| `analysis` | 解析（package の直下にあるものだけ） |
| `action` | アクション（package の直下にあるものだけ） |
| `item` | アイテム（package の直下にあるものだけ） |
| `state` | 状態（package の直下にあるものだけ） |
| `concern def` | 関心事 |
| `verification def` | 検証 |
| `occurrence def` | シナリオ |
| `port def`・`item def`・`attribute def`・`enum def` | ポート・項目・属性・列挙の定義 |
| `action def`・`state def`・`use case def` | 動作・状態・ユースケースの定義 |
| `constraint def`・`calc def`・`analysis def` | 制約・計算・解析の定義 |
| `interface def`・`connection def`・`allocation def`・`flow def` | インタフェース・接続・割り当て・フローの定義 |

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

## CLI でチェックする

```
modelith check <プロジェクトのフォルダ>
```

- `modelith.json` を読み、有効なプラグインのルールで、フォルダの中の `.sysml`・`.kerml` をチェックする。隠しフォルダ（`.modelith` を含む）・`target`・`node_modules` の中は見ない。
- 読むのは、プロジェクトに追加したプラグイン（`.modelith/plugins/`）だけ。画面で「このブラウザ」に追加したプラグインは読まない（ブラウザの中にあるため）。CI と同じ結果にしたいルールは、プロジェクトに追加する。
- 結果を 1 件 1 行で、パス・行・列の順に出し、最後にまとめを 1 行出す。行と列は 1 から数える（列は UTF-16 の単位）。

  ```
  model.sysml:3:3: エラー: 要求「KeepPressure」を満たす要素がありません [jp.example.trace/req-has-satisfier]
  model.sysml:5:3: 警告: part def「Tank」にポートがありません [jp.example.trace/part-has-ports]
  ファイル 1 件をチェックしました：エラー 1 件・警告 1 件・情報 0 件・ヒント 0 件
  ```

- ルールやマニフェストのエラー、`modelith.json` に書いてあるのに追加されていないプラグインも、エラーとして同じ形で出す（末尾の `[…]` はプラグインの ID）。

| 終了コード | 意味 |
| --- | --- |
| 0 | エラー（`error`）が無い（警告・情報だけのときもこちら） |
| 1 | エラーが 1 件以上ある。またはフォルダ・`modelith.json` を読み込めない |
| 2 | コマンドの使い方が正しくない |
