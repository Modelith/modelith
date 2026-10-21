# TypeScript のプラグイン（v1）

画面に機能（コマンド・モデルのチェック・テキストの変更）を追加するプラグインの作り方と、ホスト（Modelith）との約束（[ADR-0018](../adr/0018-plugin-host.md) §3〜§5）。
コードを含まないチェックルールのプラグインは [チェックルール（v0 のプラグイン）](check-rules.md) を見る。

型の定義元は plugin-sdk（`modelith-plugin-protocol` の `PluginManifest`・`HostMessage`・`PluginMessage`・`ModelSnapshot`）で、
TypeScript では `@modelith/plugin-sdk`、JSON Schema では plugin-sdk の `schema/plugin-manifest.schema.json`・`host-message.schema.json`・`plugin-message.schema.json` を使う。
`apiVersion` が `"0"` の間は互換を約束しない。

この版で使えるのは、コマンド・モデルのチェック（診断）・テキストの変更・インポート・エクスポート・プラグイン用の保存場所（`storage`）。

## 置き方

画面では「プラグイン → プラグインの一覧… → 追加…」でプラグインのフォルダを選び、使う権限と追加先を示して確かめてから追加する。追加先は 2 つ（ADR-0018 §1）。

| 追加先 | 置き場所 | 使える人 |
| --- | --- | --- |
| このプロジェクト（既定） | プロジェクト（[ADR-0019](../adr/0019-projects.md)）の `.modelith/plugins/<ID>/` にコピーし、`modelith.json` に登録する | Git で共有すれば、チームの全員 |
| このブラウザ | ブラウザの保存場所（IndexedDB の `modelith-plugins`）。フォルダを開けないブラウザ（Firefox・Safari）でも追加できる | 自分だけ。どのプロジェクトでも、フォルダを開いていなくても動く |

同じ ID のプラグインが両方にあるときは、プロジェクトのものを動かす（このブラウザのものは一覧に「プロジェクトを優先」と出し、動かさない）。
許可（下の「許可」）は、追加先によらず、プラグインの ID ごとに同じ規則で尋ねる。

```
my-project/
  modelith.json
  .modelith/
    plugins/
      jp.example.review/
        modelith-plugin.json
        main.js            ← 1 つのファイルにまとめたプログラム
```

`modelith.json` の `plugins.<ID>.settings` に書いた値は、そのまま `activate` の `settings` で届く（形はプラグインが決める）。このブラウザに追加したものには、`settings` は届かない。
CLI（`modelith check`）は TypeScript のプラグインを動かさない（チェックルールだけを使う）。また、このブラウザに追加したプラグインは読まない（プロジェクトのものだけ）。

## マニフェスト（`modelith-plugin.json`）

```json
{
  "id": "jp.example.review",
  "name": "レビューの記録",
  "version": "1.0.0",
  "apiVersion": "0",
  "runtime": "browser",
  "author": "山田 花子",
  "license": "MIT",
  "main": "main.js",
  "permissions": ["model:read", "edits:propose"],
  "contributes": {
    "commands": [{ "id": "review", "title": "レビュー済みの印を付ける" }],
    "importers": [{ "id": "reqif", "label": "ReqIF ファイル", "extensions": [".reqif"] }],
    "exporters": [{ "id": "csv", "label": "要求の表（CSV）", "extension": ".csv" }]
  }
}
```

| 項目 | 内容 |
| --- | --- |
| `id` | 逆ドメイン形式の ID（例：`jp.example.review`）。プロジェクトのフォルダの名前と同じにする |
| `name`・`description` | 画面に出す名前と説明 |
| `author` | 作者の名前（任意）。追加するときと、実行の許可を尋ねるときに示す。書いていなければ、許可の画面に「作者：記載なし」と出る |
| `version` | プラグインのバージョン（SemVer） |
| `apiVersion` | `"0"`（この Modelith が対応する値） |
| `runtime` | `"browser"` |
| `license` | SPDX のライセンス式 |
| `main` | プログラムのファイル。プラグインのフォルダからの相対パスで、フォルダの外は指せない。無い・見つからないときはプラグインの一覧にエラーを出し、動かさない |
| `permissions` | 使う権限（下の表）。宣言していない権限が要るメッセージは、ホストが使わずに一覧で知らせる |
| `contributes.commands` | 「プラグイン」メニューの「プラグインのコマンド」に出すコマンド（`id` と、画面に出す `title`） |
| `contributes.importers` | 「プラグイン」メニューの「プラグインでインポート」に出すインポート（`id`・画面に出す `label`・選べるファイルの拡張子 `extensions`） |
| `contributes.exporters` | 「プラグイン」メニューの「プラグインでエクスポート」に出すエクスポート（`id`・画面に出す `label`・ファイルの拡張子 `extension`） |

### 権限

| 権限 | できること | 画面の言葉 |
| --- | --- | --- |
| （なし） | テキストを受け取る（`didChange` の `text`）・コマンドを受ける・知らせを出す | 追加の権限はありません |
| `model:read` | `didChange` で解析したモデル（`ModelSnapshot`：要素・関係・範囲）を受け取り、`diagnostics` を出す | 解析したモデル（要素と関係）を受け取り、問題一覧に結果を出す |
| `edits:propose` | `proposeEdits` でテキストの変更を出す | モデルのテキストを変更する（変更は元に戻せます） |
| `network` | 外部と通信する（`fetch`・`XMLHttpRequest`・`WebSocket`） | インターネットなど外部と通信する |
| `storage` | プラグイン用の保存場所（`storageGet`・`storageSet`。下の「保存場所」） | このブラウザに、プラグイン用のデータを保存する |

インポートとエクスポートには、権限は要らない（利用者がメニューから選んだときだけ、選んだファイルの中身を渡し、結果を受け取る）。

## プログラムは 1 つのファイルにまとめる

プラグインは、サンドボックス化した iframe（`sandbox="allow-scripts"`、独自のオリジンを持たない）の中の **Worker** で、**従来型のスクリプト**として動く（ESM のモジュールとしては読まない）。

- `import`・`export` を書いたファイルはそのままでは動かない。依存（`@modelith/plugin-sdk` を含む）ごと 1 つのファイルにまとめる。
  例：`esbuild src/main.ts --bundle --format=iife --target=es2022 --outfile=main.js`
- 相対パスの `import()`・`importScripts()` は使えない（読み込む元の場所が無い）。
- プラグインのコードより先に、ホストが `EventSource`・`Worker`・`SharedWorker` を取り除く。

## やり取り

`connectToHost(self)` で、ホストとやり取りする口を作る。メッセージは `type` で種類を区別する JSON（型は `HostMessage`・`PluginMessage`）。

```ts
import { connectToHost, type ModelSnapshot } from "@modelith/plugin-sdk";

const host = connectToHost(self);
let version = 0;

host.onMessage((m) => {
  switch (m.type) {
    case "activate":
      host.send({ type: "ready" });
      break;
    case "didChange":
      version = m.version;
      if (m.model) host.send({ type: "diagnostics", version, items: check(m.model) });
      break;
    case "runCommand":
      if (m.command === "review") {
        const at = { line: 0, character: 0 };
        host.send({ type: "proposeEdits", version, edits: [{ range: { start: at, end: at }, newText: "// レビュー済み\n" }], label: "レビュー済みの印" });
      }
      host.send({ type: "commandDone", requestId: m.requestId });
      break;
  }
});

function check(model: ModelSnapshot) {
  return model.elements
    .filter((e) => e.kind === "requirement def")
    .map((e) => ({ range: e.range, severity: "warning" as const, message: `要求「${e.name}」はレビューされていません`, code: "review" }));
}
```

| ホスト → プラグイン | いつ |
| --- | --- |
| `activate { apiVersion, pluginId, settings? }` | 動かし始めたとき。プラグインは `ready` を返す |
| `didChange { version, text, model? }` | `ready` の後と、テキストを解析し直すたび。`model` は `model:read` のときだけ |
| `runCommand { requestId, command }` | 利用者がメニューからコマンドを選んだとき |
| `import { requestId, importer, fileName, base64 }` | 利用者がメニューからインポートを選び、ファイルを選んだとき（下の「インポート」） |
| `export { requestId, exporter, view? }` | 利用者がメニューからエクスポートを選んだとき。`view` は表示中の保存された図の名前（自動の図なら省く） |
| `storageResult { requestId, value? }` | `storageGet`・`storageSet` への答え（下の「保存場所」） |

| プラグイン → ホスト | ホストの扱い |
| --- | --- |
| `ready` | 準備ができた。コマンドがメニューに出る |
| `diagnostics { version, items }` | 問題一覧に、プラグインの名前（と `code`）を添えて出す。前に出した診断を置き換える。`version` が今のテキストの版でなければ使わない |
| `proposeEdits { version, edits, label? }` | 確かめてから、1 回の「元に戻す」で取り消せる 1 つの変更として当てる（下の「テキストの変更」） |
| `commandDone { requestId }` | コマンドが終わった |
| `imported { requestId, fileName, text }` | インポートの結果。新しい無題のファイルとして開く |
| `exported { requestId, fileName, mediaType, base64 }` | エクスポートの結果。ダウンロードさせる |
| `failed { requestId, message }` | コマンド・インポート・エクスポートができなかった。理由をトーストとプラグインの一覧に出す |
| `storageGet { requestId, key }`・`storageSet { requestId, key, value }` | 保存場所を読み書きして、`storageResult` で答える（`storage` のとき） |
| `notify { level, message }` | トーストに出す。`warning`・`error` はプラグインの一覧にも残す |

ホストは、届いたメッセージを plugin-sdk の型（Rust の `PluginMessage`）で読んでから使う。形の正しくないもの・宣言していない権限が要るもの・頼んでいない答えは使わず、プラグインの一覧に理由を出す。
頼んでいない答えには、番号を知らないもののほか、種類の違う依頼の番号への答え（エクスポートを頼んだ番号への `imported`、インポートを頼んだ番号への `commandDone` など）も含む。
知らないフィールドは無視する（新しい版の相手が足したフィールドで壊れない）。

## テキストの変更

- 位置は行・列（0 始まり。列は UTF-16 の単位。LSP と同じ）。
- `version` は、最後に受け取った `didChange` の `version` にする。違う・確かめている間にテキストが変わったときは当てず、「テキストが変わったため、プラグインの変更を適用しませんでした」と知らせる。
- 範囲はテキストの中にあり、互いに重ならないこと。同じ位置から始まる変更を 2 つ出さない（1 つにまとめる）。どれかが外れたら、全部を当てない。
- 当てた変更は、ふつうの編集と同じく保存の対象になり、1 回の「元に戻す」で取り消せる。

## インポート

1. 利用者が「プラグイン → プラグインでインポート → <label>…」を選ぶと、`extensions` で絞ったファイルの選択画面を出す（`extensions` が空なら絞らない）。
2. 選んだファイルの中身を base64 にして、`import { requestId, importer, fileName, base64 }` を送る。`fileName` は選んだファイルの名前。
3. プラグインは SysML v2 のテキストを作り、`imported { requestId, fileName, text }` を返す（できなければ `failed`）。
4. ホストは、`fileName` の拡張子を `.sysml` にした名前（開いている文書と重なれば `-2` などを付ける）の **新しい無題のファイル** として開く。
   開いているファイルやフォルダのファイルは書き換えない（ADR-0018 §4、C-6）。保存するまで、どこにも書き込まない。

## エクスポート

1. 利用者が「プラグイン → プラグインでエクスポート → <label>」を選ぶと、`export { requestId, exporter, view? }` を送る。モデルは、最後の `didChange` で受け取ったものを使う。
2. プラグインは `exported { requestId, fileName, mediaType, base64 }` を返す（できなければ `failed`）。
3. ホストはファイルを **ダウンロードさせる**（プロジェクトのフォルダには書かない）。`fileName` はパスを除き、使えない文字を `_` にし、拡張子が無ければマニフェストの `extension` を付ける。
   `mediaType` の形が正しくなければ `application/octet-stream` にする。base64 として正しくないものは使わず、エクスポートできなかったと知らせる。

## 大きさの上限

| 対象 | 上限 | 超えたとき |
| --- | --- | --- |
| インポートするファイル | 20 MB | 送らずに「大きすぎるためインポートできません」と知らせる |
| インポートの結果のテキスト（UTF-8） | 20 MB | 開かずに、インポートできなかったと知らせる |
| エクスポートしたファイル（base64 を戻した大きさ） | 20 MB | ダウンロードさせずに、エクスポートできなかったと知らせる |
| 保存場所（プラグインごと） | 1 MB | 保存せずに知らせる（下の「保存場所」） |

## 保存場所（`storage`）

`storage` を宣言したプラグインに、ホストがプラグインごとに分けた保存場所を貸す（プラグインはブラウザの保存場所に直接触れない。ADR-0018 §3）。

- 中身は、キー（文字列）→ 値（JSON にできる値）の集まり。ホストがプラグインの ID ごとに、このブラウザの IndexedDB（`modelith-plugins` の `data`）に置く。
  同じ ID なら、プロジェクトに追加したものも、このブラウザに追加したものも、同じ保存場所を使う。ほかの人やほかのブラウザとは共有されない。
- `storageGet { requestId, key }` には `storageResult { requestId, value }` で答える。保存していないキーなら `value` を省く。
- `storageSet { requestId, key, value }` は値を保存し、`storageResult { requestId }` で答える。`value` が `null` なら、そのキーを消す。
- **上限はプラグインごとに 1 MB**（すべてのキーと値を 1 つの JSON にしたときの UTF-8 のバイト数）。超える `storageSet` は保存せず、`storageResult { requestId }` で答え、
  「プラグイン用の保存場所の上限（1 MB）を超えるため、「キー」を保存しませんでした」とトーストとプラグインの一覧に出す。
  答えの形では、保存できたかを区別できないので、確かめたいときは `storageGet` で読み直す。
- 依頼は届いた順に 1 つずつ処理する（読み直しが前の保存を追い越さない）。
- `storage` を宣言していないプラグインの `storageGet`・`storageSet` は使わず、答えも返さず、プラグインの一覧に理由を出す。
- プラグインを削除するとき、保存したデータがあり、同じ ID のプラグインがもう一方の追加先に残らなければ、データも削除するかを尋ねる（既定は残す）。

## 許可

初めて動かす前に、名前・ID・バージョン・使う権限を示して、実行してよいかを利用者に尋ねる。`network` を宣言していれば「このプラグインは、あなたのモデルを外部に送信できます」と示す。
答えは、プラグインの ID・権限・バージョン・プログラムのファイルの SHA-256 とともに、このブラウザ（`localStorage` の `modelith-plugin-trust`）に覚える。尋ね直すのは次のときだけ。

- 宣言した権限が増えたとき
- `network` を宣言したプラグインのバージョンかファイルが変わったとき

それ以外は、権限が増えなければ、新しいバージョンを尋ねずに動かす。許可しなかったプラグインは一覧に「許可されていません」と出し、「許可する…」で尋ね直せる。

## 隔離（できないこと）

隔離用のページ（`plugin-sandbox.html`）の CSP：

```
default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'
```

`network` を宣言したプラグインは、`connect-src` だけを変えたページ（`plugin-sandbox-network.html`）で動かす：

```
default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src http: https: ws: wss:
```

| できないこと | 理由 |
| --- | --- |
| `network` を宣言していないときの通信（`fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・`navigator.sendBeacon`） | CSP の `connect-src 'none'`。`EventSource` は取り除いてある（Firefox では Worker の中で CSP をすり抜けるため） |
| 外のスクリプトの読み込み（`importScripts`・`import()`）・画像など | `script-src` は blob と、隔離用のページ自身のものだけ。`network` を宣言しても同じ |
| `eval`・`new Function`・WebAssembly | CSP に `'unsafe-eval'`・`'wasm-unsafe-eval'` を入れていない |
| `crypto.subtle`（Chromium） | blob の Worker は安全な文脈とみなされない。`crypto.getRandomValues` は使える |
| アプリの画面・下書き・開いているフォルダ・`localStorage`・IndexedDB・Cookie | 独自のオリジンを持たない iframe の中の Worker で動く。DOM も親の画面も無い |
| 入れ子の Worker・SharedWorker | 取り除いてある（新しい大域を持つため） |

止まらない処理をしても、アプリの画面は止まらない（Worker で動くため）。一覧の「停止」で iframe を取り除く。Chromium では Worker が 2 秒ほど動き続けることがあるので、画面は「停止を指示しました」と知らせる。
