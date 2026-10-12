/*
 * Modelith 要求仕様（唯一の定義元。ADR-0011）
 *
 * Modelith の要求はこのファイルだけに書く。Modelith で開くと、トレーサビリティ図で確認できる。
 *
 * 構成と約束
 *  - 利用者要求（N-*）  ：誰が何をしたいか。システム要求の導出元
 *  - システム要求（F-*, Q-*, C-*）：機能・品質・制約。必ずどれかの利用者要求から導出する（#derivation）
 *  - 方式設計（部品）     ：システム要求を満たす部品（satisfy）
 *  - 検証（verification）：要求を確かめる自動テスト。doc にテストファイルを書く（verify）
 *  - 「実装済み」とは verify されていること。verify の無い要求は未実装か未検証で、トレースの抜けとして表示される
 *  - ID は一度振ったら変えない。廃止した要求は消さずに doc の先頭に「廃止：」と書く
 *  - 振る舞いを変えるときは、実装より先にこのファイルを更新する（CLAUDE.md）
 */
package ModelithRequirements {
    private import ScalarValues::*;

    metadata def Phase { attribute stage : PhaseKind; }
    enum def PhaseKind { enum StakeholderNeeds; enum SystemRequirements; enum Architecture; enum Verification; }

    // =================================================================
    // 1. 利用者と利用者要求
    // =================================================================
    package Needs {
        @Phase { stage = PhaseKind::StakeholderNeeds; }

        part def Modeler {
            doc /* モデルを書く人（システムエンジニア・学生・研究者） */
        }
        part def Contributor {
            doc /* Modelith やプラグインを開発する人 */
        }
        concern def Productivity {
            doc /* 普段の道具と同じ感覚で、速くモデルを書けること */
            stakeholder modeler : Modeler;
        }
        concern def Trust {
            doc /* データを失わず、外部に送られず、中身を確かめられること */
            stakeholder modeler : Modeler;
            stakeholder contributor : Contributor;
        }

        requirement def <'N-1'> EditBothWaysNeed {
            doc /* テキストと図のどちらからでも、同じモデルを編集したい */
        }
        requirement def <'N-2'> ViewsNeed {
            doc /* 目的に応じた図（要求・構造・制御・内部構造・振る舞い・シーケンス）でモデルを見たい */
        }
        requirement def <'N-3'> FilesNeed {
            doc /* 手元のフォルダやクラウドのファイルを、VS Code のように開いて編集・保存したい */
        }
        requirement def <'N-4'> TraceNeed {
            doc /* 要求から設計・検証までのつながりを確かめ、抜けに気づきたい */
        }
        requirement def <'N-5'> ExportNeed {
            doc /* 図を他のツールや資料に持ち出したい */
        }
        requirement def <'N-6'> SafetyNeed {
            doc /* 作業を失わず、データを外部に送らずに使いたい */
        }
        requirement def <'N-7'> OpenSourceNeed {
            doc /* ソースを入手・確認・改変し、自分の環境にも置きたい */
        }
        requirement def <'N-8'> AnywhereNeed {
            doc /* インストールせずに、PC でもスマホでもすぐ使いたい */
        }
    }

    // =================================================================
    // 2. システム要求
    // =================================================================
    package SystemRequirements {
        @Phase { stage = PhaseKind::SystemRequirements; }
        private import Needs::*;

        // ---- 編集 --------------------------------------------------
        requirement def <'F-EDIT-1'> TextToDiagramReq {
            doc /* テキストを編集すると、入力が止まってから 0.3 秒以内に図・ツリー・問題一覧に反映する */
        }
        requirement def <'F-EDIT-2'> DiagramToTextReq {
            doc /* 図での操作（要素の追加・削除・関係の追加・移動）は、すべてテキストの編集として反映する（ADR-0001） */
        }
        requirement def <'F-EDIT-3'> RenameReq {
            doc /* 要素の名前を変えると、テキスト中の参照と配置情報もまとめて変える */
        }
        requirement def <'F-EDIT-4'> UndoReq {
            doc /* 元に戻す・やり直すができる。履歴はファイルごとに持ち、200 段階まで */
        }
        requirement def <'F-EDIT-5'> ProblemsReq {
            doc /* 構文エラー・型や参照の見つからない箇所を、行番号付きで一覧にし、クリックでその行へ移る */
        }
        requirement def <'F-EDIT-6'> ParseParityReq {
            doc /* 解析とモデル構築の結果は、仕様の基準（ゴールデン）と一致する（ADR-0002） */
        }

        // ---- ビュー ------------------------------------------------
        requirement def <'F-VIEW-1'> SevenViewsReq {
            doc /* トレーサビリティ・構造・制御ループ・内部ブロック図・振る舞い・シーケンス・すべて、の 7 つのビューを持つ */
        }
        requirement def <'F-VIEW-2'> ViewTabsReq {
            doc /* ビューをタブで複数開け、開いているタブと表示位置はブラウザに記憶する */
        }
        requirement def <'F-VIEW-3'> LayoutReq {
            doc /* 未配置の要素は自動で並べ、手で動かした配置はモデルと一緒に保存する */
        }
        requirement def <'F-VIEW-4'> CanvasReq {
            doc /* 拡大縮小・移動・範囲選択・複数選択と整列・全体図（ミニマップ）・右クリックメニューを使える */
        }
        requirement def <'F-VIEW-5'> TreeReq {
            doc /* モデルの要素をツリーで一覧・絞り込みし、選ぶと図とテキストの対応箇所を示す */
        }

        // ---- トレーサビリティ ----------------------------------------
        requirement def <'F-TRACE-1'> PhaseReq {
            doc /* @Phase で要素を工程（利用者要求・システム要求・方式設計・検証）に分け、ビューを工程で絞り込める */
        }
        requirement def <'F-TRACE-2'> TraceGapReq {
            doc /* 工程に沿った導出・充足・検証の抜けを検出し、件数と箇所を示す */
        }

        // ---- ファイル ----------------------------------------------
        requirement def <'F-FILE-1'> OpenFolderReq {
            doc /* ローカルのフォルダを開き、中の .sysml / .kerml ファイルをエクスプローラーにツリーで表示する */
        }
        requirement def <'F-FILE-2'> OpenSaveReq {
            doc /* ファイルを開いて編集し、元のファイルに上書き保存できる（Ctrl+S） */
        }
        requirement def <'F-FILE-3'> NewSaveAsReq {
            doc /* 新しいファイルを作り、名前を付けて保存できる */
        }
        requirement def <'F-FILE-4'> MultiDocReq {
            doc /* 複数のファイルを開いたまま切り替えられ、未保存の変更は切り替えても失われない */
        }
        requirement def <'F-FILE-5'> DirtyReq {
            doc /* 未保存の変更があるファイルを示し、未保存のままページを離れようとしたら警告する */
        }
        requirement def <'F-FILE-6'> AutoSaveReq {
            doc /* 自動保存を選べる。有効なら、編集が止まってから 1 秒後に保存する */
        }
        requirement def <'F-FILE-7'> ConflictReq {
            doc /* 開いた後に他のアプリでファイルが変わっていたら、黙って上書きせずに、上書き・読み直し・やめるを選ばせる */
        }
        requirement def <'F-FILE-8'> ExternalChangeReq {
            doc /* 画面に戻ったとき、未保存の変更が無いファイルは、他のアプリでの変更を読み直す */
        }
        requirement def <'F-FILE-9'> RecentFolderReq {
            doc /* 前回開いたフォルダを、ブラウザの許可を得て再び開ける */
        }
        requirement def <'F-FILE-10'> FallbackReq {
            doc /* フォルダを開けないブラウザ（Safari・Firefox）でも、ファイルの読み込みと、ダウンロードでの保存ができる */
        }
        requirement def <'F-FILE-11'> UntitledDraftReq {
            doc /* 保存先の無いファイル（無題・サンプル）は、ブラウザに自動で下書き保存し、次に開いたときに戻す */
        }
        requirement def <'F-FILE-12'> CloudReq {
            doc /* クラウドのストレージ（Google ドライブなど）のファイルも、ローカルと同じ操作で開いて保存できる（ADR-0010） */
        }

        // ---- 書き出し ----------------------------------------------
        requirement def <'F-EXP-1'> SvgExportReq {
            doc /* 表示中のビューを SVG ファイルとして保存できる */
        }
        requirement def <'F-EXP-2'> DrawioExportReq {
            doc /* 表示中のビューを draw.io で読み込める形式で書き出せる */
        }

        // ---- 品質 --------------------------------------------------
        requirement def <'Q-1'> ResponsiveReq {
            doc /* 解析中も入力や図の操作が止まらない（コアを Worker で動かす。ADR-0003） */
        }
        requirement def <'Q-2'> NarrowScreenReq {
            doc /* 幅 390px の画面でも、ツリー・図・テキストを切り替えて使える */
        }
        requirement def <'Q-3'> LookReq {
            doc /* OS の明るい・暗い配色に合わせて表示する。どちらの配色でも、マウスを乗せた部品とキーボードで選んだ部品が見分けられる */
        }

        // ---- 制約 --------------------------------------------------
        requirement def <'C-1'> TextIsSourceReq {
            doc /* モデルの正本はテキストだけとし、図の情報もテキストか、その隣のファイルに保存する（ADR-0001・ADR-0005） */
        }
        requirement def <'C-2'> PrivacyReq {
            doc /* 利用者のモデルや操作の情報を外部に送らない。フォントなども同梱し、外部の CDN やアクセス解析を使わない */
        }
        requirement def <'C-3'> SourceOfferReq {
            doc /* 動いている版（ビルドしたコミット）のソースコードへのリンクを画面に示す（AGPL 第 13 条） */
        }
        requirement def <'C-4'> StaticHostingReq {
            doc /* サーバを持たない静的なファイルとして配信でき、誰でも自分の環境に置ける */
        }
        requirement def <'C-5'> LegalNoticeReq {
            doc /* 画面から著作権表示・無保証であること・ライセンス本文（AGPL-3.0 とプラグイン例外）を確かめられ、同梱する第三者の部品のライセンス文を配布物に添える（AGPL 第 5 条 (d)・OFL・MIT・Apache-2.0） */
        }

        // ---- 導出 --------------------------------------------------
        #derivation dependency from TextToDiagramReq to EditBothWaysNeed;
        #derivation dependency from DiagramToTextReq to EditBothWaysNeed;
        #derivation dependency from RenameReq to EditBothWaysNeed;
        #derivation dependency from UndoReq to SafetyNeed;
        #derivation dependency from ProblemsReq to EditBothWaysNeed;
        #derivation dependency from ParseParityReq to EditBothWaysNeed;
        #derivation dependency from SevenViewsReq to ViewsNeed;
        #derivation dependency from ViewTabsReq to ViewsNeed;
        #derivation dependency from LayoutReq to ViewsNeed;
        #derivation dependency from CanvasReq to ViewsNeed;
        #derivation dependency from TreeReq to ViewsNeed;
        #derivation dependency from PhaseReq to TraceNeed;
        #derivation dependency from TraceGapReq to TraceNeed;
        #derivation dependency from OpenFolderReq to FilesNeed;
        #derivation dependency from OpenSaveReq to FilesNeed;
        #derivation dependency from NewSaveAsReq to FilesNeed;
        #derivation dependency from MultiDocReq to FilesNeed;
        #derivation dependency from DirtyReq to SafetyNeed;
        #derivation dependency from AutoSaveReq to SafetyNeed;
        #derivation dependency from ConflictReq to SafetyNeed;
        #derivation dependency from ExternalChangeReq to FilesNeed;
        #derivation dependency from RecentFolderReq to FilesNeed;
        #derivation dependency from FallbackReq to AnywhereNeed;
        #derivation dependency from UntitledDraftReq to SafetyNeed;
        #derivation dependency from CloudReq to FilesNeed;
        #derivation dependency from SvgExportReq to ExportNeed;
        #derivation dependency from DrawioExportReq to ExportNeed;
        #derivation dependency from ResponsiveReq to EditBothWaysNeed;
        #derivation dependency from NarrowScreenReq to AnywhereNeed;
        #derivation dependency from LookReq to AnywhereNeed;
        #derivation dependency from TextIsSourceReq to EditBothWaysNeed;
        #derivation dependency from PrivacyReq to SafetyNeed;
        #derivation dependency from SourceOfferReq to OpenSourceNeed;
        #derivation dependency from StaticHostingReq to AnywhereNeed;
        #derivation dependency from LegalNoticeReq to OpenSourceNeed;
        #derivation dependency from StaticHostingReq to OpenSourceNeed;
    }

    // =================================================================
    // 3. 方式設計（要求を満たす部品）
    // =================================================================
    package Architecture {
        @Phase { stage = PhaseKind::Architecture; }
        private import SystemRequirements::*;

        part def Core {
            doc /* パーサ・モデル構築・テキスト編集（web/src/core。暫定の TS 版。ADR-0009） */
        }
        part def DiagramUI {
            doc /* 図の描画と操作・ビュー・タブ（web/src/app） */
        }
        part def TextEditor {
            doc /* テキストの編集・色付け・問題一覧（web/src/app/editor.ts） */
        }
        part def Workspace {
            doc /* 開いているファイルと未保存の変更、保存・競合・自動保存（web/src/workspace） */
        }
        part def FileProvider {
            doc /* ストレージごとのファイル操作の抽象（web/src/files。ADR-0010） */
        }
        part def LocalFolderProvider :> FileProvider {
            doc /* File System Access API でローカルのフォルダを扱う */
        }
        part def BrowserFileProvider :> FileProvider {
            doc /* ファイルの読み込みとダウンロードだけを使う代替 */
        }
        part def CloudProvider :> FileProvider {
            doc /* Google ドライブなどのクラウド（未実装） */
        }
        part def Exporter {
            doc /* SVG・draw.io への書き出し（web/src/app/export.ts） */
        }
        part def AppShell {
            doc /* 起動・メニュー・ヘッダー・配信の設定（web/src/main.ts・vite.config.ts・Pages） */
        }

        part def Modelith {
            part core : Core;
            part diagram : DiagramUI;
            part editor : TextEditor;
            part workspace : Workspace;
            part local : LocalFolderProvider;
            part fallback : BrowserFileProvider;
            part cloud : CloudProvider;
            part exporter : Exporter;
            part shell : AppShell;
        }

        satisfy TextToDiagramReq by TextEditor;
        satisfy DiagramToTextReq by DiagramUI;
        satisfy RenameReq by DiagramUI;
        satisfy UndoReq by TextEditor;
        satisfy ProblemsReq by TextEditor;
        satisfy ParseParityReq by Core;
        satisfy SevenViewsReq by DiagramUI;
        satisfy ViewTabsReq by DiagramUI;
        satisfy LayoutReq by DiagramUI;
        satisfy CanvasReq by DiagramUI;
        satisfy TreeReq by DiagramUI;
        satisfy PhaseReq by Core;
        satisfy TraceGapReq by Core;
        satisfy OpenFolderReq by LocalFolderProvider;
        satisfy OpenSaveReq by Workspace;
        satisfy NewSaveAsReq by Workspace;
        satisfy MultiDocReq by Workspace;
        satisfy DirtyReq by Workspace;
        satisfy AutoSaveReq by Workspace;
        satisfy ConflictReq by Workspace;
        satisfy ExternalChangeReq by Workspace;
        satisfy RecentFolderReq by LocalFolderProvider;
        satisfy FallbackReq by BrowserFileProvider;
        satisfy UntitledDraftReq by Workspace;
        satisfy CloudReq by CloudProvider;
        satisfy SvgExportReq by Exporter;
        satisfy DrawioExportReq by Exporter;
        satisfy ResponsiveReq by Core;
        satisfy NarrowScreenReq by AppShell;
        satisfy LookReq by AppShell;
        satisfy TextIsSourceReq by Core;
        satisfy PrivacyReq by AppShell;
        satisfy SourceOfferReq by AppShell;
        satisfy StaticHostingReq by AppShell;
        satisfy LegalNoticeReq by AppShell;
    }

    // =================================================================
    // 4. 検証（自動テスト）
    // =================================================================
    package Verification {
        @Phase { stage = PhaseKind::Verification; }
        private import SystemRequirements::*;

        verification def CoreGoldenTest {
            doc /* web/src/core/golden.test.ts：解析とモデル構築がゴールデンと一致する */
            objective {
                verify ParseParityReq;
                verify ProblemsReq;
                verify PhaseReq;
                verify TraceGapReq;
            }
        }
        verification def TextOpsTest {
            doc /* web/src/core/text-ops.test.ts：図の操作に使うテキスト編集（挿入・削除・配置の書き込み） */
            objective {
                verify DiagramToTextReq;
            }
        }
        verification def LocalFolderProviderTest {
            doc /* web/src/files/local-folder.test.ts：フォルダの一覧・読み書き・競合の検出・ファイルの作成・前回のフォルダ（偽のファイルシステムで） */
            objective {
                verify OpenFolderReq;
                verify RecentFolderReq;
            }
        }
        verification def BrowserFileProviderTest {
            doc /* web/src/files/browser-file.test.ts：読み込みとダウンロードでの保存 */
            objective {
                verify FallbackReq;
            }
        }
        verification def WorkspaceTest {
            doc /* web/src/workspace/workspace.test.ts：開く・保存・名前を付けて保存・複数の文書・未保存の変更・競合・外部での変更・下書き */
            objective {
                verify OpenSaveReq;
                verify NewSaveAsReq;
                verify MultiDocReq;
                verify DirtyReq;
                verify ConflictReq;
                verify ExternalChangeReq;
                verify UntitledDraftReq;
            }
        }
        verification def AutoSaveTest {
            doc /* web/src/workspace/workspace.test.ts（AutoSaver）：編集が止まってから 1 秒後に保存、無効・無題・競合のときは保存しない */
            objective {
                verify AutoSaveReq;
            }
        }
        verification def ViewsE2E {
            doc /* web/e2e/views.spec.ts：7 つのビュー・タブ・拡大と範囲選択・テキストからの反映・問題一覧・ツリー・フェーズ・トレースの抜け（Chromium で操作） */
            objective {
                verify SevenViewsReq;
                verify ViewTabsReq;
                verify CanvasReq;
                verify TextToDiagramReq;
                verify ProblemsReq;
                verify TreeReq;
                verify PhaseReq;
                verify TraceGapReq;
            }
        }
        verification def EditingE2E {
            doc /* web/e2e/editing.spec.ts：図からの追加と削除・名前変更・配置の保存・ファイルごとの元に戻す（図の操作がすべてテキストに残ること） */
            objective {
                verify DiagramToTextReq;
                verify RenameReq;
                verify LayoutReq;
                verify UndoReq;
                verify TextIsSourceReq;
            }
        }
        verification def FilesE2E {
            doc /* web/e2e/files.spec.ts・fallback.spec.ts：OPFS の本物のハンドルでフォルダ・保存・切り替え・離脱時の警告・自動保存・競合・読み直し・前回のフォルダ・下書き、代替のブラウザ */
            objective {
                verify OpenFolderReq;
                verify OpenSaveReq;
                verify NewSaveAsReq;
                verify MultiDocReq;
                verify DirtyReq;
                verify AutoSaveReq;
                verify ConflictReq;
                verify ExternalChangeReq;
                verify RecentFolderReq;
                verify FallbackReq;
                verify UntitledDraftReq;
            }
        }
        verification def ShellE2E {
            doc /* web/e2e/shell.spec.ts：外部に通信しない・ソースへのリンク・著作権とライセンスの表示・狭い画面・SVG と draw.io の書き出し。e2e はすべてビルドした静的ファイルをそのまま配信して動かす */
            objective {
                verify PrivacyReq;
                verify SourceOfferReq;
                verify NarrowScreenReq;
                verify SvgExportReq;
                verify DrawioExportReq;
                verify StaticHostingReq;
                verify LegalNoticeReq;
            }
        }
        verification def VisualUITest {
            doc /* web/e2e/visual.spec.ts：7 つのビュー・幅 390px・メニュー・インスペクタ・右クリックメニュー・エクスプローラー・競合ダイアログ・問題一覧・トレースの絞り込みと抜け・マウスやキーボードで選んだ部品の見た目を、明るい／暗い配色で基準画像と比べる */
            objective {
                verify SevenViewsReq;
                verify NarrowScreenReq;
                verify LookReq;
                verify CanvasReq;
                verify OpenFolderReq;
                verify OpenSaveReq;
                verify ConflictReq;
                verify ProblemsReq;
                verify PhaseReq;
                verify TraceGapReq;
                verify SourceOfferReq;
            }
        }
        verification def LayoutTest {
            doc /* web/src/app/layout.test.ts：配置情報の読み書き */
            objective {
                verify LayoutReq;
            }
        }
    }
}
