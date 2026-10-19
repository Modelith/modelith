// plugin-sdk の packages/typescript/src/generated/protocol.ts のコピー。編集しないこと。
// 取得元: git+https://github.com/modelith/plugin-sdk?rev=9fb8f904670cec12f39e0576c24b09ee94738269#9fb8f904670cec12f39e0576c24b09ee94738269
// 更新: Cargo.toml の plugin-sdk の rev を変えてから node web/tools/plugin-protocol-cli.ts sync（scripts/check.sh が古さを検出する）

// 生成物。編集しないこと。定義元: crates/modelith-plugin-protocol
// 再生成: UPDATE_GENERATED=1 cargo test -p modelith-plugin-protocol --test generated

export const API_VERSION = "0";
export const PLUGIN_ID_PATTERN = "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$";
export const RULE_ID_PATTERN = "^[a-z0-9][a-z0-9-]*$";

export type PluginId = string;

export type Position = { line: number, character: number, };

export type Range = { start: Position, end: Position, };

export type TextEdit = { range: Range, newText: string, };

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export type Diagnostic = { range: Range, severity: DiagnosticSeverity, message: string, 
/**
 * ルール ID など。
 */
code?: string, 
/**
 * 報告元のプラグイン ID など。
 */
source?: string, };

export type Runtime = "rules" | "browser" | "wasm-component";

export type Permission = "model:read" | "edits:propose" | "network" | "storage";

export type Importer = { id: string, label: string, 
/**
 * 対応する拡張子（例: `.reqif`）。
 */
extensions: Array<string>, };

export type Exporter = { id: string, label: string, 
/**
 * 出力ファイルの拡張子（例: `.drawio`）。
 */
extension: string, };

export type View = { id: string, label: string, };

export type PaletteItem = { id: string, label: string, 
/**
 * 配置時に挿入する SysML v2 テキストの雛形。
 */
snippet: string, };

export type Command = { id: string, title: string, };

export type Contributes = { 
/**
 * 検査ルールのファイル（YAML）。
 */
rules?: Array<string>, importers?: Array<Importer>, exporters?: Array<Exporter>, views?: Array<View>, palette?: Array<PaletteItem>, commands?: Array<Command>, };

export type PluginManifest = { id: PluginId, 
/**
 * 表示名。
 */
name: string, 
/**
 * プラグイン自身のバージョン（SemVer）。
 */
version: string, 
/**
 * 対象とするプラグイン API のメジャーバージョン（plugin-sdk のメジャーバージョン）。
 */
apiVersion: string, runtime: Runtime, description?: string, 
/**
 * SPDX ライセンス式。
 */
license: string, 
/**
 * エントリポイント（`browser`: ESM ファイル、`wasm-component`: .wasm ファイル）。`rules` では不要。
 */
main?: string, 
/**
 * 要求する権限。宣言していない操作はホストが拒否する。
 */
permissions?: Array<Permission>, contributes?: Contributes, };

export type Publisher = { name: string, 
/**
 * GitHub のユーザー名または組織名。
 */
github: string, };

export type Pricing = "free" | "paid";

export type RegistryVersion = { version: string, 
/**
 * 配布物の URL。
 */
url: string, 
/**
 * 配布物の SHA-256（16 進小文字）。
 */
sha256: string, 
/**
 * 配布物の署名。
 */
signature?: string, };

export type RegistryEntry = { id: PluginId, name: string, publisher: Publisher, 
/**
 * ソースリポジトリの URL。
 */
repository: string, apiVersion: string, runtime: Runtime, 
/**
 * SPDX ライセンス式。
 */
license: string, pricing: Pricing, versions: Array<RegistryVersion>, };

export type RuleId = string;

export type OneOrMany = string | Array<string>;

export type CountRange = { min?: number, max?: number, };

export type Requirement = { 
/**
 * この種類の関係（例: `satisfy`）を 1 本以上受ける。並びはいずれかでよい。
 */
incoming?: OneOrMany, 
/**
 * この種類の関係（例: `derivation`）を 1 本以上出す。並びはいずれかでよい。
 */
outgoing?: OneOrMany, 
/**
 * 要素名がこの正規表現に当たる。
 */
name?: string, 
/**
 * `true` なら工程（`@Phase`）を持つ、`false` なら持たない。
 */
phase?: boolean, 
/**
 * ポートの数。
 */
ports?: CountRange, 
/**
 * 同じ形の条件の否定（満たさないこと）。
 */
not?: Requirement, };

export type ElementMatch = { 
/**
 * 要素の種類（例: `requirement def`）。並びはいずれかに当たればよい。
 */
kind: OneOrMany, 
/**
 * 工程（`@Phase`）の名前（例: `SystemRequirements`）。
 */
phase?: string, 
/**
 * 要素名の正規表現。
 */
name?: string, };

export type Rule = { 
/**
 * プラグインの中で一意な ID。診断の `code` になる。
 */
id: RuleId, severity: DiagnosticSeverity, 
/**
 * 診断のメッセージ。`{name}`（要素名）と `{kind}`（要素の種類）を差し込める。
 */
message: string, 
/**
 * ルールを当てる要素。
 */
match: ElementMatch, 
/**
 * 当たった要素が満たすべき条件。
 */
require: Requirement, };

export type RuleSet = { rules: Array<Rule>, };

export type PortDirection = "in" | "out" | "inout";

export type ModelPort = { name: string, 
/**
 * ポートの型の名前。型を書いていなければ省く。
 */
type?: string, 
/**
 * 向き。書いていなければ省く。
 */
direction?: PortDirection, };

export type ModelElement = { 
/**
 * 要素を指す鍵。`ModelRelation` の `from` / `to` はこの値を使う。
 */
key: string, name: string, 
/**
 * 要素の種類（例: `part def`）。検査ルールの `match.kind` と同じ言葉。
 */
kind: string, 
/**
 * 工程（`@Phase`）の名前。
 */
phase?: string, ports: Array<ModelPort>, 
/**
 * テキスト上の位置。
 */
range: Range, };

export type RelationKind = "satisfy" | "verify" | "frame" | "derivation" | "flow";

export type ModelRelation = { id: string, kind: RelationKind, 
/**
 * 出る側の要素の `key`。
 */
from: string, 
/**
 * 受ける側の要素の `key`。
 */
to: string, };

export type ModelSnapshot = { elements: Array<ModelElement>, relations: Array<ModelRelation>, };

export type NotifyLevel = "info" | "warning" | "error";

export type HostMessage = { "type": "activate", apiVersion: string, pluginId: PluginId, 
/**
 * プロジェクトの設定（`modelith.json` の `plugins.<id>.settings`）。形はプラグインが決める。無ければ省く。
 */
settings?: unknown, } | { "type": "didChange", 
/**
 * テキストの版。診断や変更案は、どの版に対するものかをこの値で示す。
 */
version: number, text: string, 
/**
 * 解析結果。マニフェストで `model:read` を宣言したときだけ送る。
 */
model?: ModelSnapshot, } | { "type": "runCommand", requestId: number, command: string, } | { "type": "import", requestId: number, importer: string, fileName: string, 
/**
 * ファイルの中身（base64）。
 */
base64: string, } | { "type": "export", requestId: number, exporter: string, 
/**
 * 表示中の図の名前。無ければモデル全体。
 */
view?: string, } | { "type": "storageResult", requestId: number, 
/**
 * `storageGet` で読んだ値。無ければ省く。
 */
value?: unknown, };

export type PluginMessage = { "type": "ready" } | { "type": "diagnostics", version: number, items: Array<Diagnostic>, } | { "type": "proposeEdits", version: number, edits: Array<TextEdit>, 
/**
 * 「元に戻す」に出す名前。
 */
label?: string, } | { "type": "commandDone", requestId: number, } | { "type": "imported", requestId: number, fileName: string, text: string, } | { "type": "exported", requestId: number, fileName: string, mediaType: string, 
/**
 * ファイルの中身（base64）。
 */
base64: string, } | { "type": "failed", requestId: number, message: string, } | { "type": "storageGet", requestId: number, key: string, } | { "type": "storageSet", requestId: number, key: string, value: unknown, } | { "type": "notify", level: NotifyLevel, message: string, };
