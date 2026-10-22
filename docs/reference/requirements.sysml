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
 *  - ID は一度振ったら変えない。廃止した要求は消さずに doc の先頭に「廃止：」と書く。先送りした要求は doc の先頭に「保留：<版> 以降」と書く（verify が無くてよい）
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
        requirement def <'N-10'> ExtendNeed {
            doc /* 組織の決まりに沿った検査や、ほかのツールとのやり取りを、自分たちで足したい。足したものを、画面と CI で同じように使いたい */
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
            doc /* テキストを編集すると、入力が止まってから 0.3 秒以内に解析を始め、結果を図・ツリー・問題一覧に反映する（反映までの目安は 1 秒以内） */
        }
        requirement def <'F-EDIT-2'> DiagramToTextReq {
            doc /* 図での操作（要素の追加・削除・関係の追加・移動）は、すべてテキストの編集として反映する（ADR-0001）。
                   関係の追加では、要求をつなぐ関係（要求と検証の「検証する」・要求と部品の「満たす」・要求と関心事の「扱う」・要求どうしの導出の両向き）を、
                   どちらの要素から線を引き始めても候補に出し、SysML v2 の規格どおりの向き（部品が要求を満たす・検証が要求を確かめる など）でテキストに書く */
        }
        requirement def <'F-EDIT-3'> RenameReq {
            doc /* 要素の名前を変えると、テキスト中の参照と配置情報もまとめて変える。日本語や空白を含む名前も付けられ、テキストには引用名（'電気 ケトル'）で書く（8.2.2.3） */
        }
        requirement def <'F-EDIT-12'> EditDetailsReq {
            doc /* テキストを書かずに、インスペクタで要素の説明（要求なら要求の文章。テキストの doc）を書き換え・足し・消すことができる。
                   文が 2 行以上でも、行の区切りを保ってテキストに書く。定義の属性（名前・型・値）も、足す・書き換える・消すことができ、
                   書き換えても constant などの修飾と値の書き方（:=・default）は保つ（ADR-0001） */
        }
        requirement def <'F-EDIT-4'> UndoReq {
            doc /* 元に戻す・やり直すができる。履歴はファイルごとに持ち、200 段階まで */
        }
        requirement def <'F-EDIT-5'> ProblemsReq {
            doc /* 構文エラー・型や参照の見つからない箇所を、行番号付きで一覧にし、クリックでその行へ移る */
        }
        requirement def <'F-EDIT-6'> ParseParityReq {
            doc /* モックと同じ振る舞いの範囲では、解析とモデル構築の結果はゴールデン（モックの出力）と一致する（ADR-0002・ADR-0013） */
        }
        requirement def <'F-EDIT-8'> NoSilentDropReq {
            doc /* 正しい SysML v2 の宣言を黙って捨てたり、別の意味に取り違えたりしない。まだ扱えない構文は「まだ扱えない」と知らせる（ADR-0013） */
        }
        requirement def <'F-EDIT-7'> NewPackageGuideReq {
            doc /* package の無いファイルで図から要素を置こうとしたら、断らずに新しい package を作るよう案内し、名前を決めて作ったうえで要素を置く */
        }
        requirement def <'F-EDIT-9'> WordHelpReq {
            doc /* テキストの語（SysML v2 のキーワード・標準ビューの名前・よく使う標準ライブラリの名前）の意味を、SysML v2 の構文を知らない人にも分かる言葉で示す（ADR-0014）。
                   広い画面では、語にマウスを乗せるとツールチップで示し、カーソルのある語の意味をテキストの下の 1 行に示す。コメントと文字列の中の語は説明しない */
        }
        requirement def <'F-EDIT-10'> PhoneTextReq {
            doc /* 狭い画面（幅 760px 以下）は、モデルを見る・確かめる画面とする。テキストは初めは読み取り専用で（触ってもキーボードが出ない）、
                   「編集」ボタンで編集できるようにし、もう一度押すと読み取り専用に戻す。語をダブルタップすると、その語を選び、意味を示す（F-EDIT-9） */
        }
        requirement def <'F-EDIT-11'> ProblemLevelReq {
            doc /* 保留：0.2.0 以降。問題一覧と図の印に出す知らせ（トレースの抜けの種類ごと・まだ扱えない構文・チェックルールの結果など）の重さを、
                   利用者が種類ごとに「エラー」「警告」「情報」「出さない」から選べる（lint の規則の重さを変えるのと同じ）。構文エラーは出さないにできない。
                   設定はプロジェクト（modelith.json）とこのブラウザの両方に置け、どちらが効くかは F-PROJ-2 の決まりに従う */
        }

        // ---- ビュー ------------------------------------------------
        requirement def <'F-VIEW-1'> BuiltInViewsReq {
            doc /* トレーサビリティ・ブロック定義図・制御ループ・内部ブロック図・振る舞い・シーケンス図・アクティビティ図・すべて、の 8 つのビューを持つ */
        }
        requirement def <'F-VIEW-2'> ViewTabsReq {
            doc /* ビューをタブで複数開け、開いているタブと表示位置はブラウザに記憶する。記憶したタブが壊れていても（JSON でない・形の合わない項目がある）起動は止まらず、形の合わない項目だけを捨てて残りを戻す */
        }
        requirement def <'F-VIEW-3'> LayoutReq {
            doc /* 未配置の要素は自動で並べ、手で動かした配置は、モデルごとの配置ファイル（model.sysml の隣の model.layout.json）に保存する（ADR-0005） */
        }
        requirement def <'F-VIEW-6'> UnsavedLayoutReq {
            doc /* 配置の保存先が無いとき（ファイルを 1 つだけ開いた・新規）は「配置は未保存」と画面に示し、保存の際に保存先を選ばせる。配置が黙って失われることはない（ADR-0005）。
                   新しいファイルは保存先のフォルダと名前を選ばせて、モデルと配置ファイルを一緒に作る。1 つだけ開いたファイルは、そのファイルのあるフォルダを開くよう尋ねる。
                   フォルダを開けないブラウザでは、保存でモデルと配置ファイルを両方ダウンロードし、開くときに 2 つを一緒に選べば配置も戻る */
        }
        requirement def <'F-VIEW-7'> StandardViewReq {
            doc /* テキストに書かれた SysML v2 標準の view を図として表示し、expose された要素だけを描く。図の種類は標準のビュー定義（GeneralView・InterconnectionView・ActionFlowView・StateTransitionView・SequenceView）から決める（ADR-0005）。
                   expose は要素（A）・中身（A::*）・入れ子すべて（A::**、A::*::**）と、[...] の絞り込みを扱い、filter は @メタクラス と @メタデータ（istype・hastype も）で絞り込み、
                   それを and・or・xor・not と括弧で組み合わせられる。render の asTreeDiagram・asInterconnectionDiagram と、それを特殊化した rendering（合成形の
                   render rendering r :> asTreeDiagram { … } と、別に書いた rendering の参照）は図の種類より優先する。扱えない図の種類・描き方・絞り込みは、黙って捨てずに問題一覧で知らせる */
        }
        requirement def <'F-VIEW-10'> SequenceReq {
            doc /* シーケンス図は、シナリオ（occurrence def）の部品をライフラインにし、メッセージ・ライフラインの上のイベント（部品の中の部品のイベントを含む）・イベントの間の順序（継起）を、
                   順序に合わせて上から描く（9.2.20.2.7 SequenceView・8.2.3.9）。メッセージ・順序の相手のイベントが見つからないときと、順序が循環しているときは、問題一覧で知らせる */
        }
        requirement def <'F-VIEW-8'> CreateViewReq {
            doc /* 図のメニュー・図のツールバー・サイドバーの「図」の「新しい図を作成」で、名前と図の種類を選んで図を作成する。種類は「今の図のまま」（表示中の図の要素と配置のまま）・
                   一般の図（空の図から始める）・内部ブロック図・アクティビティ図・状態遷移図・シーケンス図で、後の 4 つは描く対象（部品定義・アクション定義・状態定義・シナリオ）を
                   モデルから選ぶか、新しく作る。作成した図に要素を入れたり、図から外したりできる。
                   ＋メニューでは、自動で描く図と作成した図を見出しで分けて示し、タブのツールチップでも作成した図であることを示す。テキストには標準の view と expose として書き、利用者には view・expose という言葉を見せない（ADR-0005・ADR-0014）。
                   図から外しても、モデルの要素は消さない。モデルから削除するのは別の操作にする */
        }
        requirement def <'F-VIEW-12'> RequirementDiagramReq {
            doc /* 要求図（一般ビュー）で、要求の区画に前提（assume）と満たすべき制約（assert。否定は assert not）の式を、
                   検証・解析の区画に目的（objective）の説明と式を書く（8.2.3.20〜22）。部品定義などにも満たすべき制約を書く。
                   package の直下の検証・解析の使用も図の要素にし、型の無い使用の中の verify からも検証の線を引く（8.2.3.24） */
        }
        requirement def <'F-VIEW-13'> BlockDiagramReq {
            doc /* ブロック定義図（一般ビュー）で、package の直下の action・item・state の使用も図の要素にする。
                   要素の説明（doc）をすべての定義の区画に書き（8.2.3.4 の documentation-compartment）、
                   別の言語での表し方（rep）を «rep» と言語を見出しにした角を折った四角で、持ち主への破線と描く（8.2.3.4 の textual-representation-node） */
        }
        requirement def <'F-VIEW-14'> InterconnectionDiagramReq {
            doc /* 内部ブロック図で、対象そのもののポート（ブロックの外とのつなぎ口）への線を、対象の枠の辺の上に置いたポートへ引く（入力は左・出力は右・双方向は下の辺。8.2.3.13）。
                   その線も、ほかの線と同じく選んで削除できる。型の無い部品は、本体に書いたポートを描く。
                   部品の中の部品（入れ子の部品）の接続点もポートにでき、つながっていた線は「a.x.ポート」のように部品の道のりのまま書き換える */
        }
        requirement def <'F-VIEW-15'> ActivityDiagramReq {
            doc /* アクティビティ図で、アクションのパラメータ（in・out・inout）をアクションの縁の接続点に、アクション定義そのもののパラメータを枠の上に描き（入力は左・出力は右・双方向は下）、
                   パラメータの間の流れ（flow）を実線と矢印で描く（8.2.3.17 の parameter と flow）。型のあるアクションで本体にパラメータが無ければ、型の定義のパラメータを描く。
                   流れも段の決め方に使い、図から選んで削除できる。パラメータの向きや宣言はテキストで書き換える。
                   中にアクションの流れを書いたアクション（入れ子の本体）は、その中に要素・開始と終了・線を描き（8.2.3.17 の action-body）、外の図と同じく選んで消したり名前を変えたりできる。
                   図から引く順序の線は、同じアクションの中の要素どうしに限り、そのアクションの本体に書く */
        }
        requirement def <'F-VIEW-11'> ViewListReq {
            doc /* サイドバーの「図」に作成した図を並べ、選ぶと開く。一覧とツリーの右クリックから、作成した図の名前を変えたり、削除したりできる。
                   名前を変えても図の配置と開いているタブは保ち、削除しても図に出していたモデルの要素は残す（確認を取る）。テキストでは view の宣言の名前を変える・宣言を消す（ADR-0005） */
        }
        requirement def <'F-VIEW-9'> PackageFrameReq {
            doc /* 図に package そのものを出したとき（expose P）、package を枠（フォルダ形）として描き、中の要素を枠の中に示す（8.2.3.5 の package の記法、ADR-0005） */
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
            doc /* 工程に沿った導出・充足・検証の抜けを検出し、件数と箇所を示す。抜けの件数のボタンや問題一覧の抜けの行を押すと、今いる画面に合わせて移る。
                   図が見えていれば、抜けのある要素を選んで図の中央に出し、少しの間強調する（今の図に無ければ、その要素が載る図に切り替える）。
                   テキストだけを見ているとき（狭い画面のテキストのタブ）は、テキストの該当の行へ移る。
                   図では、何が足りないか（導出・充足・検証）と直し方を図の言葉で示し、その場で関係を追加できるようにし、テキストへも 1 回の操作で移れる。
                   抜けが複数あれば「1 / 3 件目」のように何件目かを示し、前後へ順に移れる（両端で回る）。抜けのある要素の箱には、何が足りないかを添えた印を付ける。
                   抜けの文の頭には要求の名前を 1 回だけ書く（短い名前があれば前に添える） */
        }

        // ---- ファイル ----------------------------------------------
        requirement def <'F-FILE-1'> OpenFolderReq {
            doc /* ローカルのフォルダを開き、中の .sysml / .kerml ファイルをエクスプローラーにツリーで表示する */
        }
        requirement def <'F-FILE-2'> OpenSaveReq {
            doc /* ファイルを開いて編集し、元のファイルに上書き保存できる（Ctrl+S） */
        }
        requirement def <'F-FILE-3'> NewSaveAsReq {
            doc /* 新しいファイルを作り、名前を付けて保存できる。作る場所は開いたフォルダの中だけで、フォルダの外を指す名前（`..`・`.`・`\`）は断って知らせる */
        }
        requirement def <'F-FILE-4'> MultiDocReq {
            doc /* 複数のファイルを開いたまま切り替えられ、未保存の変更は切り替えても失われない */
        }
        requirement def <'F-FILE-5'> DirtyReq {
            doc /* 未保存の変更があるファイルを示し、未保存のままページを離れようとしたら警告する */
        }
        requirement def <'F-FILE-6'> AutoSaveReq {
            doc /* 自動保存を選べる。有効なら、編集が止まってから 1 秒後に保存する。保存できなかったとき（フォルダの許可が切れた・ディスクの空きが無い）は、黙って失敗せずに理由を知らせ、未保存の印（●）を残す */
        }
        requirement def <'F-FILE-7'> ConflictReq {
            doc /* 開いた後に他のアプリでファイルが変わっていたら、黙って上書きせずに、上書き・読み直し・やめるを選ばせる。
                   図の配置（要素の位置）を保存する隣の配置ファイルも同じ（読んだときの版と比べ、変わっていれば同じ選択を出す。まだ無ければ作る） */
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
            doc /* 保存先の無いファイル（無題・サンプル）は、ブラウザに自動で下書き保存し、次に開いたときに戻す。中身の無いファイルは下書きに残さない。
                   下書きを保存できないとき（ブラウザの保存領域がいっぱい）は、黙って諦めずに 1 回だけ知らせて「名前を付けて保存」を案内し、保存できていない下書きがあるままページを離れようとしたら警告する */
        }
        requirement def <'F-FILE-12'> CloudReq {
            doc /* 保留：0.2.0 以降（ADR-0012。利用者の声が出てから着手する）。クラウドのストレージのファイルも、ローカルと同じ操作で開いて保存できる。最初は Google ドライブに対応し、サーバを持たずにブラウザから直接つなぐ（ADR-0010・ADR-0012） */
        }
        requirement def <'F-FILE-13'> ResumeSessionReq {
            doc /* 起動すると、前回の続き（開いていたフォルダとファイル、表示していたファイル、図のタブ）から始める。フォルダを読み直すのにブラウザの許可が要るときは、サンプルの代わりに「前回の続きを開く」を示し、1 回の操作で戻れる。設定で、起動時にサンプルを開くようにもできる */
        }
        requirement def <'F-FILE-15'> MultiFileModelReq {
            doc /* フォルダを開いているときは、フォルダの中の .sysml・.kerml のすべてを 1 つのモデルとして扱う（ADR-0021）。
                   ほかのファイルの一番上の要素はその名前で、パッケージの中の要素は import（P::A・P::*・P::**）か修飾名で使え、「見つかりません」と出さない。
                   private の要素と private import で取り込んだ名前は、ほかのファイルへ見せない（SysML v2 8.2.2.5）。
                   図には、表示中のファイルの要素と、それが参照するほかのファイルの要素だけを、どのファイルのものかが分かるように描く。
                   ほかのファイルに書いた図・関係・問題は、表示中のファイルの図と問題に混ぜない。
                   ほかのファイルの要素を図から書き換えようとしたら、書き換えずに、どのファイルにあるかを知らせ、そのファイルを開けるようにする */
        }
        requirement def <'F-FILE-14'> NoOpenFileReq {
            doc /* 最後のファイルを閉じても、新しいファイルを勝手に作らない。開いているファイルが無いときは、そのことと、新しいファイル・ファイルを開く・サンプルを開く操作を示す。すべて閉じて終えたら、次に開いたときもファイルを開いていない状態から始める */
        }

        // ---- エクスポート ------------------------------------------
        requirement def <'F-EXP-1'> SvgExportReq {
            doc /* 「ファイル」メニューの「エクスポート…」で、ファイル名と形式（SVG 画像）を選び、表示中の図を SVG のファイルとしてダウンロードできる。
                   ファイル名の既定は表示中の図の名前で、拡張子は選んだ形式に合わせて付ける（付け替える）。開いているファイルが無いときは選べない */
        }
        requirement def <'F-EXP-2'> DrawioExportReq {
            doc /* 「ファイル」メニューの「エクスポート…」で、ファイル名と形式（draw.io）を選び、表示中の図を draw.io で開ける .drawio のファイルとしてダウンロードできる。
                   ファイル名の決め方と、開いているファイルが無いときの扱いは F-EXP-1 と同じ */
        }

        // ---- プラグイン（ADR-0004・ADR-0018） -------------------------
        requirement def <'F-PLUG-1'> RuleCheckReq {
            doc /* プロジェクトかブラウザに入れたプラグインの検査ルール（YAML）でモデルを検査し、結果を問題一覧に、どのプラグインのどのルールかを添えて示す */
        }
        requirement def <'F-PLUG-2'> RuleParityReq {
            doc /* プロジェクトに入れた検査ルールを CLI（modelith check <フォルダ>）でも実行でき、画面と同じ結果を返す。error の結果があれば 0 以外で終わり、CI で使える。
                   プロジェクトのフォルダの外を読まないよう、modelith.json とプラグインのファイルのシンボリックリンクはたどらず、読めないファイルとして知らせる */
        }
        requirement def <'F-PLUG-3'> PluginErrorReq {
            doc /* 読めないマニフェストやルール（未知の項目・対応しない apiVersion・正規表現の誤り）を黙って無視せず、どのファイルの何が悪いかを示す */
        }
        requirement def <'F-PLUG-4'> ScriptPluginReq {
            doc /* TypeScript のプラグインが足したコマンド・インポート・エクスポートを、画面から使える。インポートした結果は新しいファイルとして開き、既存のファイルを黙って書き換えない。
                   エクスポートしたファイルは、プラグインが宣言した拡張子で保存する（プラグインが返した名前の拡張子が違っても、宣言した拡張子に置き換える） */
        }
        requirement def <'F-PLUG-5'> PluginEditReq {
            doc /* プラグインからの変更は、テキストの編集案として受け取り、テキストが変わっていたら適用せずに知らせる。適用した変更は 1 回の「元に戻す」で取り消せる（ADR-0001） */
        }
        requirement def <'F-PLUG-6'> PluginTrustReq {
            doc /* コードを含むプラグインは、初めて動かす前に、名前・作者・版・使う権限を示して利用者に許可を求める。外部と通信できるプラグインは、そのことをはっきり示す。権限が増えたとき、または外部と通信できるプラグインの版かファイルが変わったときは、もう一度尋ねる */
        }
        requirement def <'F-PLUG-7'> PluginSandboxReq {
            doc /* プラグインは、宣言していない権限を使えない。外部との通信を宣言していなければ通信できず、アプリの下書き・開いているフォルダ・ブラウザの保存場所に直接触れない。
                   プラグインが大きすぎるメッセージや大量のメッセージを送っても、画面は動き続ける：大きさの上限を超えたメッセージと、扱い終わっていないメッセージの数の上限を超えた分は、入口で捨てて一覧で知らせ、
                   捨てた数が上限に達したら止めて知らせる。1 回の診断で問題一覧に出す件数と、利用者への知らせ（通知）の 1 秒あたりの件数にも上限を置き、超えた分は捨ててそのことを示す */
        }
        requirement def <'F-PLUG-8'> PluginListReq {
            doc /* 画面でプラグインを追加できる。入れる先は「このプロジェクト」（既定。チームと CI で共有）か「このブラウザ」（自分だけ）から選ぶ。
                   入れたプラグインの一覧・状態・誤り・許可を確かめ、有効・無効の切り替えと削除ができる（ADR-0018・ADR-0019）。
                   コマンド・インポート・エクスポートが期限（30 秒）までに、起動が期限（10 秒）までに終わらないときは、トーストと一覧の行でそのことを知らせ、一覧の「停止」で止められる。勝手には止めない */
        }
        requirement def <'F-PLUG-9'> MissingPluginReq {
            doc /* プロジェクトが使うと書いてあるプラグインが入っていない・版が違うときは、何が足りないかと、追加する操作を示す */
        }

        // ---- プロジェクト（ADR-0019） --------------------------------
        requirement def <'F-PROJ-1'> ProjectReq {
            doc /* 開いたフォルダを「プロジェクト」として扱い、名前・使うプラグイン・チームで共有する設定を、フォルダの一番上の modelith.json に保存する。画面に今のプロジェクト名を示す。
                   modelith.json の無いフォルダも今までどおり開いて使え、「プロジェクトにする」を選んだときに初めて作る */
        }
        requirement def <'F-PROJ-2'> SettingsLevelReq {
            doc /* 設定は「このプロジェクトの設定」（チームで共有。結果に効くもの）と「自分の設定」（このブラウザ。見た目と操作の好み）の 2 段だけにし、1 つの項目はどちらか一方にだけ属する */
        }

        // ---- 文書へのリンク（ADR-0019） --------------------------------
        requirement def <'F-LINK-1'> DocumentLinkReq {
            doc /* 保留：0.2.0 以降（ADR-0019）。要素に文書（プロジェクトの中のファイル・Web の URL）へのリンクを付け、画面から開ける。リンクはテキストにメタデータとして書き、プロジェクトの中のファイルはプロジェクトのフォルダからの相対パスで書く。リンク先を勝手に読みに行かない */
        }
        requirement def <'F-LINK-2'> LinkCheckReq {
            doc /* 保留：0.2.0 以降（ADR-0019。F-LINK-1 の後）。プロジェクトの中のファイルへのリンクが切れていたら、問題一覧に示す */
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
        requirement def <'Q-5'> RobustReq {
            doc /* どんなテキストを入れても解析で止まらず（深い入れ子・書き損じ・途中までの入力を含む）、読めない箇所は問題一覧で知らせる。起動に必要な部品を読み込めないときは、白い画面のままにせず、理由と対処を示す。
                   起動に必要な部品を読み込んでいる間は、最初の表示から「読み込み中…」と示し、使える状態になったら消す。
                   15 秒たっても読み込めないときは、通信が遅いかブラウザが古い可能性と、ページの再読み込みを案内する。案内を出した後も読み込みは待ち続け、読み込めたら案内を消して使えるようにする */
        }
        requirement def <'Q-4'> PlainWordsReq {
            doc /* 画面の文言（トースト・ダイアログ・空の図の案内・メニュー・問題一覧）は、SysML v2 の構文を知らない人にも分かる図の言葉で書き、次の操作を画面の操作で示す。SysML v2 の用語は補足にとどめる（ADR-0014）。
                   ブラウザが返したエラー（許可が無い・ファイルが見つからない・空きが足りない など）も、英語のまま見せず、何が起きたかと次の操作を日本語で示す。分からないエラーは一般的な文にし、元の英語はブラウザのコンソールにだけ残す */
        }
        requirement def <'Q-6'> NoSilentFailureReq {
            doc /* 予期しない例外（捕まえていない例外・結果を待たない処理の失敗）で黙って止まらず、「予期しない問題が起きました。テキストはそのまま残っています」と知らせる（例外 1 つにつき知らせは 1 回。詳しい内容はブラウザのコンソールに残す）。
                   起動して画面を組み立てる途中で失敗したら、白い画面のままにせず、保存した設定（パネルの配置・図のタブ）を初期化して読み直す操作を示す。下書き・前回の続き・プラグインの許可は消さない */
        }
        requirement def <'Q-7'> CoreRecoveryReq {
            doc /* テキストを読み取り図の操作を計算する部品（コア。Worker で動く）が止まった・10 秒たっても返事をしないときは、待ち続けない。
                   待っていた図の操作はやめて「図の操作をやめました。テキストはそのまま残っています」と知らせ、テキストの編集と保存（Ctrl+S）は続けられる。
                   部品は作り直して、今のテキストとプラグインを送り直し、解析と図の操作を再開する。作り直した部品が 10 秒たっても使える状態にならないときは、止まったものとして同じように扱う。
                   1 分の間に 3 回作り直しても止まるときはあきらめ、
                   同期の表示で図を更新できないことと、ページの再読み込みを案内する（ADR-0016） */
        }
        requirement def <'Q-8'> KeyboardReq {
            doc /* マウスを使わず、キーボードだけで画面を操作できる。ダイアログを開いている間は、Tab で入力がダイアログの外へ出ず、背景のボタンを押せない。
                   ダイアログを閉じたら、開く前の要素（メニューから開いたときはそのメニュー）に入力を戻す。ダイアログとファイル・ヘルプのメニューは Esc で閉じる。
                   図のタブとモデルツリーには Tab で入れる（入る先は選んでいるタブ・行。行を選んでいなければ先頭の行）。図のタブは左右の矢印キーと Home・End で切り替え、ツリーは上下の矢印キーで行を移る */
        }
        requirement def <'Q-9'> MenuBarReq {
            doc /* 画面の上の左に、ほかのアプリと同じ並びのメニュー（ファイル・編集・表示・図・プラグイン・ヘルプ）と、元に戻す・やり直すのボタンを置く。同期の状態と開発段階の札は右に置く。
                   メニューの項目には、近道のキーがあれば添える。メニューを開いている間は、左右の矢印キーで隣のメニューへ、上下の矢印キーで項目を移れ、マウスを隣のメニューに乗せるとそのメニューに切り替わる。
                   幅の狭い画面では、メニューを左の ☰ の 1 つにまとめる */
        }

        // ---- 制約 --------------------------------------------------
        requirement def <'C-1'> TextIsSourceReq {
            doc /* モデルの正本はテキストだけとする。図の中身は標準の view としてテキストに、配置はテキストの隣の配置ファイルに保存する（ADR-0001・ADR-0005） */
        }
        requirement def <'C-2'> PrivacyReq {
            doc /* 利用者のモデルや操作の情報を、利用者が選んだ保存先（手元のファイル、利用者自身のクラウドストレージ）以外に送らない。フォントなども同梱し、外部の CDN やアクセス解析を使わない。クラウドを使わない利用者は、配信元以外と通信しない（ADR-0012） */
        }
        requirement def <'C-3'> SourceOfferReq {
            doc /* 動いている版（ビルドしたコミット）のソースコードへのリンクを画面に示す（AGPL 第 13 条） */
        }
        requirement def <'C-4'> StaticHostingReq {
            doc /* サーバを持たない静的なファイルとして配信でき、誰でも自分の環境に置ける */
        }
        requirement def <'C-5'> LegalNoticeReq {
            doc /* 画面に著作権表示・無保証であること・ライセンスの条件で再配布できることを示し（AGPL 第 0 条の適切な法的表示）、ライセンスの中身は動いている版の GitHub のライセンスの節で読めるようにする。
                   本体のライセンス文（AGPL-3.0 とプラグイン例外）と、同梱する第三者の部品のライセンス文は、配布物に添える（AGPL 第 4・6 条、OFL・MIT・Apache-2.0） */
        }
        requirement def <'C-7'> TrademarkReq {
            doc /* SysML®・OMG® が Object Management Group, Inc. の登録商標、KerML™ が同社の商標であることと、Modelith が OMG と関係のない独立したプロジェクトで、OMG の認定や推奨を受けていないことを、画面と README に示す。仕様への適合（conformance）はうたわない（仕様書の TRADEMARKS・COMPLIANCE） */
        }
        requirement def <'C-8'> StageNoticeReq {
            doc /* 正式版の前（alpha・beta・rc）は、見出しと「ヘルプ」に、動いている版の開発段階を示す。段階は版の名前から決め、正式版では示さない */
        }
        requirement def <'C-10'> ReleaseChannelReq {
            doc /* 安定版（最新の正式版、無ければ最新の rc）とプレリリース版（最も新しい版）を、別の URL で同時に公開する。プレリリース版を公開しても、安定版の URL の画面は変えない。
                   2 つの版のブラウザの保存（前回の続き・下書き・設定・プラグインの許可・フォルダの許可）は分け、新しい版が書いた形式を古い版に読ませない（ADR-0020） */
        }
        requirement def <'C-9'> ContentPolicyReq {
            doc /* 配信する画面に Content-Security-Policy を付け、配信元以外との通信・外から読み込むスクリプト・インラインのスクリプトを、
                   ブラウザの仕組みで止める。エスケープの漏れが 1 つあっても、それだけでは任意のスクリプトが動かないようにする（C-2 の機械的な裏付け） */
        }
        requirement def <'C-6'> NoSilentWriteReq {
            doc /* 利用者の SysML ファイルには、利用者が操作したときにだけ書き込む。配置など Modelith 独自の情報は、テキストに書かない（ADR-0005）。
                   古い形式の配置（テキスト内の @layout コメント）は黙って消さず、配置ファイルに移してコメントを消すかを、ファイルを開いたときに一度だけ尋ねる */
        }

        // ---- 導出 --------------------------------------------------
        #derivation dependency from TextToDiagramReq to EditBothWaysNeed;
        #derivation dependency from DiagramToTextReq to EditBothWaysNeed;
        #derivation dependency from NewPackageGuideReq to EditBothWaysNeed;
        #derivation dependency from NoSilentDropReq to EditBothWaysNeed;
        #derivation dependency from WordHelpReq to EditBothWaysNeed;
        #derivation dependency from PhoneTextReq to AnywhereNeed;
        #derivation dependency from RenameReq to EditBothWaysNeed;
        #derivation dependency from UndoReq to SafetyNeed;
        #derivation dependency from ProblemsReq to EditBothWaysNeed;
        #derivation dependency from ProblemLevelReq to EditBothWaysNeed;
        #derivation dependency from ParseParityReq to EditBothWaysNeed;
        #derivation dependency from BuiltInViewsReq to ViewsNeed;
        #derivation dependency from ViewTabsReq to ViewsNeed;
        #derivation dependency from LayoutReq to ViewsNeed;
        #derivation dependency from UnsavedLayoutReq to SafetyNeed;
        #derivation dependency from StandardViewReq to ViewsNeed;
        #derivation dependency from EditDetailsReq to EditBothWaysNeed;
        #derivation dependency from CreateViewReq to ViewsNeed;
        #derivation dependency from ViewListReq to ViewsNeed;
        #derivation dependency from BlockDiagramReq to ViewsNeed;
        #derivation dependency from InterconnectionDiagramReq to ViewsNeed;
        #derivation dependency from ActivityDiagramReq to ViewsNeed;
        #derivation dependency from RequirementDiagramReq to ViewsNeed;
        #derivation dependency from PackageFrameReq to ViewsNeed;
        #derivation dependency from SequenceReq to ViewsNeed;
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
        #derivation dependency from ResumeSessionReq to FilesNeed;
        #derivation dependency from NoOpenFileReq to FilesNeed;
        #derivation dependency from MultiFileModelReq to FilesNeed;
        #derivation dependency from SvgExportReq to ExportNeed;
        #derivation dependency from RuleCheckReq to ExtendNeed;
        #derivation dependency from RuleParityReq to ExtendNeed;
        #derivation dependency from PluginErrorReq to ExtendNeed;
        #derivation dependency from ScriptPluginReq to ExtendNeed;
        #derivation dependency from PluginEditReq to EditBothWaysNeed;
        #derivation dependency from PluginTrustReq to SafetyNeed;
        #derivation dependency from PluginSandboxReq to SafetyNeed;
        #derivation dependency from PluginListReq to ExtendNeed;
        #derivation dependency from MissingPluginReq to ExtendNeed;
        #derivation dependency from ProjectReq to FilesNeed;
        #derivation dependency from ProjectReq to ExtendNeed;
        #derivation dependency from SettingsLevelReq to ExtendNeed;
        #derivation dependency from DocumentLinkReq to TraceNeed;
        #derivation dependency from LinkCheckReq to TraceNeed;
        #derivation dependency from DrawioExportReq to ExportNeed;
        #derivation dependency from ResponsiveReq to EditBothWaysNeed;
        #derivation dependency from NarrowScreenReq to AnywhereNeed;
        #derivation dependency from LookReq to AnywhereNeed;
        #derivation dependency from PlainWordsReq to EditBothWaysNeed;
        #derivation dependency from RobustReq to SafetyNeed;
        #derivation dependency from NoSilentFailureReq to SafetyNeed;
        #derivation dependency from CoreRecoveryReq to SafetyNeed;
        #derivation dependency from KeyboardReq to EditBothWaysNeed;
        #derivation dependency from MenuBarReq to EditBothWaysNeed;
        #derivation dependency from TextIsSourceReq to EditBothWaysNeed;
        #derivation dependency from PrivacyReq to SafetyNeed;
        #derivation dependency from NoSilentWriteReq to SafetyNeed;
        #derivation dependency from TrademarkReq to OpenSourceNeed;
        #derivation dependency from SourceOfferReq to OpenSourceNeed;
        #derivation dependency from StaticHostingReq to AnywhereNeed;
        #derivation dependency from LegalNoticeReq to OpenSourceNeed;
        #derivation dependency from StageNoticeReq to SafetyNeed;
        #derivation dependency from ReleaseChannelReq to SafetyNeed;
        #derivation dependency from ContentPolicyReq to SafetyNeed;
        #derivation dependency from StaticHostingReq to OpenSourceNeed;
    }

    // =================================================================
    // 3. 方式設計（要求を満たす部品）
    // =================================================================
    package Architecture {
        @Phase { stage = PhaseKind::Architecture; }
        private import SystemRequirements::*;

        part def Core {
            doc /* パーサ・モデル構築・図の操作のテキスト編集（Rust の crates/modelith-core を wasm にして、Web Worker の中で動かす。ADR-0003・ADR-0015・ADR-0016） */
        }
        part def DiagramUI {
            doc /* 図の描画と操作・ビュー・タブ（web/src/app） */
        }
        part def TextEditor {
            doc /* テキストの編集・色付け・問題一覧・語の説明（web/src/app/editor.ts・glossary.ts・word-help.ts） */
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
            doc /* Google ドライブなどのクラウド（未実装。方式は ADR-0012、保留中） */
        }
        part def Exporter {
            doc /* SVG・draw.io へのエクスポート（中身は web/src/app/export.ts、形式とファイル名は export-file.ts、「エクスポート…」のダイアログは export-dialog.ts） */
        }
        part def RuleEngine {
            doc /* 検査ルール（v0、YAML）の解釈（crates/modelith-core。ブラウザと CLI で同じコード。ADR-0018） */
        }
        part def PluginHost {
            doc /* プラグインの読み込み・許可・サンドボックス・やり取り（web/src/plugins。ADR-0018） */
        }
        part def Project {
            doc /* プロジェクトとその設定（modelith.json）の読み書き（crates/modelith-core と web/src/workspace。ADR-0019） */
        }
        part def Cli {
            doc /* コマンドラインの modelith（crates/modelith-cli） */
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
            part rules : RuleEngine;
            part plugins : PluginHost;
            part cli : Cli;
            part project : Project;
        }

        satisfy TextToDiagramReq by TextEditor;
        satisfy DiagramToTextReq by DiagramUI;
        satisfy NewPackageGuideReq by DiagramUI;
        satisfy NoSilentDropReq by Core;
        satisfy WordHelpReq by TextEditor;
        satisfy PhoneTextReq by TextEditor;
        satisfy RenameReq by DiagramUI;
        satisfy EditDetailsReq by DiagramUI;
        satisfy UndoReq by TextEditor;
        satisfy ProblemsReq by TextEditor;
        satisfy ProblemLevelReq by AppShell;
        satisfy ParseParityReq by Core;
        satisfy BuiltInViewsReq by DiagramUI;
        satisfy ViewTabsReq by DiagramUI;
        satisfy LayoutReq by DiagramUI;
        satisfy UnsavedLayoutReq by Workspace;
        satisfy StandardViewReq by DiagramUI;
        satisfy CreateViewReq by DiagramUI;
        satisfy ViewListReq by DiagramUI;
        satisfy BlockDiagramReq by DiagramUI;
        satisfy InterconnectionDiagramReq by DiagramUI;
        satisfy ActivityDiagramReq by DiagramUI;
        satisfy RequirementDiagramReq by DiagramUI;
        satisfy PackageFrameReq by DiagramUI;
        satisfy SequenceReq by DiagramUI;
        satisfy NoSilentWriteReq by Workspace;
        satisfy TrademarkReq by AppShell;
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
        satisfy ResumeSessionReq by LocalFolderProvider;
        satisfy FallbackReq by BrowserFileProvider;
        satisfy UntitledDraftReq by Workspace;
        satisfy CloudReq by CloudProvider;
        satisfy ResumeSessionReq by Workspace;
        satisfy NoOpenFileReq by Workspace;
        satisfy MultiFileModelReq by Core;
        satisfy MultiFileModelReq by Workspace;
        satisfy SvgExportReq by Exporter;
        satisfy RuleCheckReq by RuleEngine;
        satisfy RuleParityReq by Cli;
        satisfy PluginErrorReq by RuleEngine;
        satisfy PluginErrorReq by PluginHost;
        satisfy ScriptPluginReq by PluginHost;
        satisfy PluginEditReq by PluginHost;
        satisfy PluginTrustReq by PluginHost;
        satisfy PluginSandboxReq by PluginHost;
        satisfy PluginListReq by PluginHost;
        satisfy MissingPluginReq by PluginHost;
        satisfy ProjectReq by Project;
        satisfy SettingsLevelReq by Project;
        satisfy DocumentLinkReq by DiagramUI;
        satisfy LinkCheckReq by RuleEngine;
        satisfy DrawioExportReq by Exporter;
        satisfy ResponsiveReq by Core;
        satisfy NarrowScreenReq by AppShell;
        satisfy LookReq by AppShell;
        satisfy PlainWordsReq by AppShell;
        satisfy RobustReq by Core;
        satisfy RobustReq by AppShell;
        satisfy NoSilentFailureReq by AppShell;
        satisfy CoreRecoveryReq by Core;
        satisfy CoreRecoveryReq by AppShell;
        satisfy KeyboardReq by AppShell;
        satisfy KeyboardReq by DiagramUI;
        satisfy MenuBarReq by AppShell;
        satisfy TextIsSourceReq by Core;
        satisfy PrivacyReq by AppShell;
        satisfy SourceOfferReq by AppShell;
        satisfy StaticHostingReq by AppShell;
        satisfy LegalNoticeReq by AppShell;
        satisfy StageNoticeReq by AppShell;
        satisfy ReleaseChannelReq by AppShell;
        satisfy ContentPolicyReq by AppShell;
    }

    // =================================================================
    // 4. 検証（自動テスト）
    // =================================================================
    package Verification {
        @Phase { stage = PhaseKind::Verification; }
        private import SystemRequirements::*;

        verification def CoreGoldenTest {
            doc /* web/src/core/golden.test.ts：解析とモデル構築がゴールデンと一致する（Rust のコアで。ADR-0015・ADR-0016） */
            objective {
                verify ParseParityReq;
                verify ProblemsReq;
                verify PhaseReq;
                verify TraceGapReq;
            }
        }
        verification def TextOpsTest {
            doc /* web/src/core/text.test.ts：コアが返したテキスト編集の適用と、古い形式の配置コメントの読み込み・削除（どう書き換えるかは RustEditTest） */
            objective {
                verify DiagramToTextReq;
                verify NoSilentWriteReq;
            }
        }
        verification def SpecCasesTest {
            doc /* web/src/core/spec.test.ts：SysML v2 仕様に合わせるケース（前置メタデータ・部分集合と再定義・引用名と短い名前・まだ扱えない文の通知・view と expose・filter・render・package を枠にする expose・誤った表示の修正：rep・assert not・assume・verify・viewpoint の frame・まだ扱えない構文の本体・修飾名・alias・alpha.7 で読むようにした構文：case・actor・include use case・enum の使用・event occurrence・timeslice・snapshot・typed by・constant・variant・viewpoint・rendering・metadata about・利用者定義のキーワード・satisfy の書き方・名前付きの制約の参照・標準ライブラリの型の名前、alpha.8 で描くようにした特殊化・部分集合・再定義・参照・依存の線と多重度、単独の connect・n 項の接続・結び付け・割り当て・flow def と名前付きのフロー、値の種類（=・:=・default）・individual、alpha.9 で読むようにしたアクションの節（fork・join・merge・decide・send・accept・assign・terminate・if・while・for）・継起（first … then・then・if … then・else）・succession flow と、見つからない継起の相手、遷移のトリガ・via・ガード・効果・名前と状態の中の省略形の遷移・最初の遷移・見つからない遷移の相手・状態の entry・do・exit と parallel、then event occurrence の継起・ビューの filter の and・or・xor・not・括弧と istype・hastype・render の合成形と rendering の参照・シナリオの順序の見つからない相手と循環・3 段以上の特徴量の連鎖とその見つからない段、alpha.10 で直した誤った表示：true・false・not で始まる結果の式・本体付きの式（->collect{…}）・KerML の宣言・依存と別名の本体の注釈・メタデータの本体の再定義の形（:>> x = 1）・交差（=>・crosses）・キーワードの無い特性と ref r;・名前付きの流れるもの・定義の中の型の無い部品を端にした接続と流れ・宣言する形の satisfy・verify と視点の satisfy・共役のポートの定義の名前（Pt::'~Pt'）・メタクラスのライブラリの型、alpha.10 で読むようにした from を省いた flow・succession flow・message と connect を省いた interface・既にある要素を指す perform・exhibit・frame）。期待値は仕様から手で書く（ADR-0013）。Rust のパーサとモデル構築で動かす（ADR-0015・ADR-0016）。web/src/app/geometry.test.ts：package の枠の大きさ（中の要素と中の枠を囲む）・区画の属性の行（多重度と特殊化の相手）・線の端の多重度の位置・特殊化した定義を下の段に置く配置・n 項の接続の点の位置・中の部品を囲む部品の矩形と、中の部品を縦に積む配置・区画の初期値と既定値（:=・default）・見出しの «individual …»・メモの本文の行と高さと、注釈する要素の近くに置く配置。web/src/app/svg.test.ts・export.test.ts：線の種類ごとの破線と矢印（8.2.3。割り当て・結び付け・n 項の接続・メモの破線を含む）と、メモの記号（角を折った四角）と、draw.io の線の形。web/src/app/notes.test.ts：一般ビューに、図に出した要素を注釈するメモと線を足す。web/src/app/annotations.test.ts：インスペクタのメモと別の言語での表し方（comment・rep）。web/src/app/ibd.test.ts：内部ブロック図の中身（流れと接続・名前付きのフローのラベル・結び付け・n 項の接続の点・部品の中の部品と、部品の型の中の線）と、その線の ID で Rust のコアが同じ線を消せること。web/src/app/action-flow.test.ts：アクティビティ図の中身（要素・継起とガードのラベル・順序付きの流れ）、記号（開始・終了・棒・ひし形・五角形・角の丸い四角）と線の記法（8.2.3.17）、継起の向きの段で上から並べる配置、図から引ける順序の線、要素の画面の言葉。web/src/app/state-machine.test.ts：状態遷移図の中身（状態・入れ子の状態・開始と終了の記号・遷移と トリガ [ガード] / 効果 のラベル・並行の領域）、記号（角の丸い四角と entry・do・exit の区画・塗った丸・丸の中の塗った丸・領域を区切る破線）と大きさ、本体ごとに遷移の向きに左から並べる配置と座標の無い状態の置き方、図から引ける遷移、名前の変更でのキーの付け替え、画面の言葉。export.test.ts：アクティビティ図・状態遷移図の draw.io の図形と線。web/src/app/sequence.test.ts：シーケンス図の中身（ライフライン・段の順のメッセージ・イベントとその札・イベントの間の順序の線・段の数）と記法（白抜きの丸・破線と開いた矢印・丸の縁までのメッセージ、8.2.3.9）、draw.io のイベントの図形。ibd.test.ts と geometry.test.ts：3 段以上の連鎖の端の部品と、入れ子の部品の高さと幅。0.2.0 で描くようにした要求図：検証・解析の使用の中の verify（型の無い使用からも線を引く）と、geometry.test.ts の要求の区画の前提と満たすべき制約（assert not）・部品定義の満たすべき制約・検証の目的の区画。0.2.0 のブロック定義図：notes.test.ts の別の言語での表し方の «rep» のメモと線、geometry.test.ts の部品定義の説明の区画。0.2.0 の内部ブロック図：ibd.test.ts の対象そのもののポートへの線（枠の上のポート b:名前）と、その線の ID で Rust のコアが同じ線を消せること、型の無い部品の本体のポート、geometry.test.ts の枠の上のポートの位置。0.2.0 のアクティビティ図：action-flow.test.ts のアクションのパラメータの接続点・アクション定義そのもののパラメータ（枠の上）・パラメータの間の流れの線と、流れで決める段、その記号、入れ子の本体の要素（container）と、その中と外の間に順序の線を引けないこと、中に流れを描くアクションの記号 */
            objective {
                verify ActivityDiagramReq;
                verify InterconnectionDiagramReq;
                verify BlockDiagramReq;
                verify RequirementDiagramReq;
                verify StandardViewReq;
                verify PackageFrameReq;
                verify SequenceReq;
                verify NoSilentDropReq;
            }
        }
        verification def RustSyntaxTest {
            doc /* crates/modelith-core/src/syntax・project：Rust のパーサの字句と構文木（木の形・依存の相手の並び・接続の端（2 項・n 項・bind・allocate）・種類のキーワードの無い individual・継起の端とガード・succession flow・アクションの節（制御の節・send・accept・assign・terminate・if・while・loop・for）とその引数と本体・遷移の元と先・トリガ・ガード・効果（本体を含む）と状態の中の省略形の遷移・parallel・then event の参照の形・render の合成形の名前・キーワードで始まる結果の式・本体付きの式・KerML の宣言を本体ごと 1 つのまだ扱えない文にすること・交差（=>・crosses）・流れるものの節・connect を省いた interface の端・ロスレス・途中で切った入力や深い入れ子でも止まらない・まだ扱えない文を節として残す・構文エラーの位置）と、暫定コアと同じ形の解析結果への投影（番号での参照・UTF-16 の位置・接続・結び付け・割り当て・フローの宣言と関係・値の書き方（:=・default）・コメントの本文と注釈する相手・別の言語での表し方の言語と本文・individual・書いた語を種類にしたアクションの節・if と while の条件と本体（else の本体）・直前の要素から引く継起とガード・順序付きの流れ・遷移の名前・トリガ・via・ガード・効果と直前の状態から引く省略形の遷移・entry の直後の最初の遷移・状態の entry・do・exit と並行の状態・then event occurrence の継起と、状態の本体ではイベントを継起の元にしないこと・render の合成形の rendering と、view の表し方の相手・キーワードの無い特性と ref r; の参照の使用・メタデータの本体の再定義の形の値・依存と別名の本体を読まないこと・KerML の宣言のまだ扱えない文・宣言する形の satisfy・verify の要求・Pt::'~Pt' を共役の型にすること・from を省いたフロー・順序付きの流れ・メッセージの端・perform・exhibit・frame の参照の形）。web/src/core/rust.test.ts：コアが失敗しても例外を投げずに知らせる。ADR-0015 */
            objective {
                verify RequirementDiagramReq;
                verify NoSilentDropReq;
                verify ProblemsReq;
                verify RobustReq;
            }
        }
        verification def RustModelTest {
            doc /* crates/modelith-core/src/model：Rust のモデル構築（キーと ID の付け方・ポートの向き・見つからない型・フェーズとトレースの抜け（文の頭の要求の名前は短い名前の有無によらず 1 回）・view の expose と filter・番号での参照・特殊化・部分集合・再定義・参照・依存・割り当ての線と、部品として持つ線の端の多重度・名前付きのフローのラベル・n 項の接続と結び付けの相手の検査・図に描く要素を注釈するメモのキーと相手・見つからないメモの相手・アクション定義ごとのアクションの流れの要素のキーと線の ID・見つからない継起の相手・ActionFlowView の描き方・状態定義ごとの状態遷移の図の要素のキー（入れ子と開始・終了の記号）と線の ID とラベル・並行の状態・見つからない遷移の相手・シナリオごとのシーケンス図のライフライン・イベント（入れ子の部品と型の中のもの）・メッセージの段と順序に合わせた段の決め方・イベントの間の順序の線・見つからない順序の相手と循環する順序・filter の論理式の読み方と優先順位・render がたどる rendering・3 段以上の特徴量の連鎖と見つからない段・定義の中の型の無い部品を端にした接続と流れ・宣言する形の satisfy・verify と視点の satisfy・frame の参照の形・交差を書く部品の線の端・メタクラスのライブラリの型・from を省いたフロー・順序付きの流れ・メッセージと connect を省いた interface の線）と、乱数で作った入力を解析とモデル構築に通しても止まらないこと（ファジング）。web/src/core/model-diff.test.ts：同じ解析結果から、Rust と暫定の TS のモデル構築が同じモデルを作る（途中まで書いた入力と、乱数で組み合わせた入力で。alpha.7 で Rust だけが直した修飾名・verify・frame・alias の読み方と、…Value・…Kind の型の判定と、alpha.9 で Rust だけが確かめる遷移の相手・特徴量の連鎖の段・シナリオの順序と、alpha.10 で Rust だけが見つかれば問題にしない接続・流れの端は比べない）。web/src/core/rust.test.ts：状態遷移の図とシーケンス図を宣言・関係の参照に戻す。ADR-0016・package の直下の action・item・state の使用を図の要素にする・アクションの流れの図のパラメータ（本体のものと型の定義のもの）・アクション定義そのもののパラメータ・パラメータの間の流れの線と見つからない流れの相手・入れ子の本体の要素のキーと開始・終了と線、入れ子の本体の要素のパラメータへ段をたどる流れ。複数のファイルにまたがるモデル（ADR-0021）：import（P::A・P::*・P::**）と修飾名と一番上の要素でのほかのファイルの名前の解決、取り込んでいない名前・private の要素・private import の取り込み直しを見せないこと、同じファイルの割り切りと同じ名前の優先、表示中のファイルの要素と参照したほかのファイルの要素だけを残すこと（ファイルの番号・キーを変えないこと・ほかのファイルの図と問題を混ぜないこと・view が示すほかのファイルの要素）。crates/modelith-core/src/project：ファイルごとの解析結果をつなぐときの番号と位置のずらし方 */
            objective {
                verify MultiFileModelReq;
                verify ActivityDiagramReq;
                verify BlockDiagramReq;
                verify RequirementDiagramReq;
                verify ParseParityReq;
                verify ProblemsReq;
                verify PhaseReq;
                verify TraceGapReq;
                verify StandardViewReq;
                verify SequenceReq;
                verify RobustReq;
            }
        }
        verification def RustEditTest {
            doc /* crates/modelith-core/src/edit：図の操作（要素の追加・部品の追加・名前の変更・削除・関係の削除・関係の追加・メッセージ・フェーズ・ポート・図の保存（空の一般の図を含む）と図への出し入れ・図の名前の変更と削除。図のテキストの引用名・修飾名・package を足す位置を含む）を、キーで要素を指す意図としてテキストに当て、編集後のテキストを比べる。内部ブロック図の線の ID（結び付け・n 項の接続・部品の中の部品・部品の型の中の線）と、部品の中の部品への流れの書き方も比べる。名前の変更で値の書き方（:=・default）が残り、コメントの about の相手も変わること、メモのキーでコメントを削除できることも比べる。アクションの流れ図の線（継起）の削除・要素の削除と名前の変更・図からの順序の線の追加（first … then）・アクションの流れ図の保存（ActionFlowView）、状態遷移の図の遷移の削除（transition の文・省略形の遷移・最初の遷移）・入れ子の状態の削除と名前の変更・図からの遷移の追加（同じ本体・本体をまたぐ名前の道のり・終了の記号へ）・状態遷移の図の保存（StateTransitionView）、シーケンス図のイベントの間の順序の線の削除、3 段以上の連鎖の端の部品（u:a.x.v）の線の削除と名前の変更も比べる。断る場合（見つからない要素・使えない名前）と、乱数で選んだ意図でも止まらないこと。web/src/core/rust.test.ts：UTF-16 の位置の編集を返し、コアが失敗しても例外を投げない。ADR-0016。内部ブロック図の対象そのもののポート（b:名前）への線の ID と削除、入れ子の部品の接続点をポートにしたときの流れの端の書き換えも比べる。アクションの流れ図の入れ子の本体の要素の名前の変更と線の削除、入れ子の本体の中に引く順序の線と、本体をまたぐ順序の線を断ること 。複数のファイル（ADR-0021）：ほかのファイルとつないだモデルで操作し、ほかのファイルの要素に触れる操作（名前の変更・削除）はそのファイルを添えて断ること、ほかのファイルの要求を満たす関係は表示中のファイルに書くこと。crates/modelith-core/src/project：覚えたファイルのパスの順・置き換え・忘れ方 */
            objective {
                verify MultiFileModelReq;
                verify ActivityDiagramReq;
                verify InterconnectionDiagramReq;
                verify EditDetailsReq;
                verify DiagramToTextReq;
                verify RenameReq;
                verify NewPackageGuideReq;
                verify CreateViewReq;
                verify ViewListReq;
                verify PhaseReq;
                verify RobustReq;
            }
        }
        verification def CoreWorkerTest {
            doc /* web/src/core/client.test.ts：画面とコア（Worker）のやり取り。テキストに版を付けて送り、古い版の解析結果は捨て、返事を待つ間にテキストが変わった編集は使わない。コアが壊れた返事をしても例外を投げない。e2e：Worker で動くコアのまま、画面からの操作が反映される。ADR-0016 */
            objective {
                verify ResponsiveReq;
                verify RobustReq;
            }
        }
        verification def CoreRecoveryTest {
            doc /* web/src/core/client.test.ts：コアの返事の期限（期限の直前の返事は使い、期限で待っていた依頼をすべて失敗にする）・Worker のエラーで待ちを解くこと・
                   wasm の例外（失敗の返事）を止まったと扱うこと・止まった後に送った依頼をすぐ断ること・つなぎ直したときに今のテキストとプラグインを送り直すこと。
                   web/src/core/supervisor.test.ts：止まったら Worker を終了して作り直す・1 分の間の作り直しの上限（3 回は作り直し、4 回目はあきらめる）・作り直しに失敗したらあきらめる・
                   作り直した Worker が期限までに起動しなければ止まったと扱う（期限の直前の起動は使い、期限が切れたら終了して作り直し、上限を超えたらあきらめる）。
                   web/e2e/recovery.spec.ts：Worker がエラーを起こしたとき・返事をしなくなったときに、トーストで知らせ、Ctrl+S で保存でき、作り直した後は図の操作が再び効き、
                   作り直しが続いたら同期の表示で再読み込みを案内する */
            objective {
                verify CoreRecoveryReq;
                verify OpenSaveReq;
            }
        }
        verification def StartupLoadingTest {
            doc /* web/src/app/loading.test.ts：起動中の表示を 15 秒（期限の 1 ms 手前は「読み込み中…」のまま）で案内に切り替え、使える状態になったら消す（案内の後に使える状態になっても消す）。
                   web/e2e/startup.spec.ts：wasm の読み込みが遅いときに最初の表示から「読み込み中…」を示して読み込めたら消すこと、15 秒たつと案内に切り替え、その後に読み込めたら案内を消して図を描くこと、読み込めないときは「読み込み中…」を消して理由と対処を示すこと（Chromium で操作） */
            objective {
                verify RobustReq;
            }
        }
        verification def NewPackageTest {
            doc /* web/src/app/new-package.test.ts：ファイル名からの package 名の候補・名前の検査 */
            objective {
                verify NewPackageGuideReq;
            }
        }
        verification def ViewNamesTest {
            doc /* web/src/app/labels.test.ts：図の種類の画面の名前（広く知られた図の名前）と、ツールチップに添える SysML v2 の標準ビューの名前（自動の図・作成した図・タブ）、標準ビュー定義の短い名前（afv など）の読み替え、図の名前の候補の「〜の図」 */
            objective {
                verify PlainWordsReq;
                verify BuiltInViewsReq;
                verify StandardViewReq;
            }
        }
        verification def GlossaryTest {
            doc /* web/src/app/glossary.test.ts：テキストの位置にある語の説明（語の始まりと終わりの位置・空白・範囲外・表に無い語・コメントと文字列と引用名の中の語・2 語と 3 語のキーワード・主なキーワードの画面の言葉・8 つの標準ビューの名前と短い名前・標準ライブラリの型と単位） */
            objective {
                verify WordHelpReq;
                verify PlainWordsReq;
            }
        }
        verification def CspTest {
            doc /* web/tools/csp.test.ts：Content-Security-Policy の中身（既定は配信元だけ・eval を許さない・wasm と Worker と同梱フォントは許す）と、ビルドした HTML への差し込み */
            objective {
                verify ContentPolicyReq;
            }
        }
        verification def ReleaseChannelTest {
            doc /* web/tools/channels.test.ts：公開済みのリリースから、安定版（最新の正式版、無ければ最新の rc）とプレリリース版（最も新しい版）を選ぶ（番号は数として比べる・下書きと版でないタグは選ばない・正式版も rc も無い・リリースが無い）。
                   web/src/channel.test.ts：保存の名前を系列ごとに分ける（安定版はそのまま・プレリリース版は @preview・系列の無いビルドは安定版と同じ） */
            objective {
                verify ReleaseChannelReq;
            }
        }
        verification def StageTest {
            doc /* web/src/app/stage.test.ts：版の名前から開発段階の表示を決める（alpha・beta・rc の札と説明、正式版・知らない段階・読めない版では示さない） */
            objective {
                verify StageNoticeReq;
            }
        }
        verification def TraceGapGuideTest {
            doc /* web/src/app/trace-gap.test.ts：トレースの抜けの位置から図の要素を引く（宣言の始まり・範囲の中で最も内側・範囲の外・末尾・要素が無い）、
                   抜けの種類（下位への展開・導出元・満たす要素・検証・知らない文）の判断と、種類ごとの案内の文と印のツールチップ、
                   何件目に移るか（0 件・1 件・前後・両端で回る・範囲外の番号）、移る先の画面（広い画面・狭い画面の図・テキスト・ツリーのタブ） */
            objective {
                verify TraceGapReq;
            }
        }
        verification def RelationOptionsTest {
            doc /* web/src/app/relations.test.ts：2 つの要素の間に追加できる関係の候補。要求をつなぐ関係（要求 → 検証・検証 → 要求・要求 → 部品（定義と使用）・部品 → 要求・
                   要求どうしの導出の両向き・要求と関心事）を、線の向きによらず規格どおりの向きで出すこと（逆向きの候補の印）、自分自身と要求を含まない組み合わせでは出さないこと、
                   「〜として持つ」など既存の候補を残すこと */
            objective {
                verify DiagramToTextReq;
            }
        }
        verification def TapTest {
            doc /* web/src/app/tap.test.ts：タップ（動きと時間の上限）とダブルタップ（間の時間と離れ方の上限）の判定 */
            objective {
                verify PhoneTextReq;
            }
        }
        verification def LocalFolderProviderTest {
            doc /* web/src/files/local-folder.test.ts：フォルダの一覧・読み書き・競合の検出・ファイルの作成（フォルダの外を指す名前と空の名前は断る）・前回のフォルダ・隣のファイル（配置ファイル）の読み書きと競合の検出（読んだ後に変わっていれば書かない・消えていれば作り直す）・1 つだけ開いたファイルをフォルダの中から探す・起動したときに許可を求めずに前回のフォルダの許可を確かめる（偽のファイルシステムで） */
            objective {
                verify OpenFolderReq;
                verify NewSaveAsReq;
                verify ConflictReq;
                verify RecentFolderReq;
                verify ResumeSessionReq;
                verify RobustReq;
                verify LayoutReq;
                verify UnsavedLayoutReq;
            }
        }
        verification def BrowserFileProviderTest {
            doc /* web/src/files/browser-file.test.ts：読み込みとダウンロードでの保存、モデルと一緒に選んだ・ダウンロードした配置ファイル */
            objective {
                verify FallbackReq;
                verify UnsavedLayoutReq;
            }
        }
        verification def WorkspaceTest {
            doc /* web/src/workspace/workspace.test.ts：開く・保存・名前を付けて保存・複数の文書・未保存の変更・競合（テキストと配置ファイル。強制の上書きと読み直し）・外部での変更・下書き・隣の配置ファイルの読み書きと「配置は未保存」・フォルダに名前を付けて保存・1 つだけ開いたファイルのフォルダを開く・古い形式の配置の移行・すべて閉じた状態と中身の無い下書きの扱い・前回の続きの書き込み（戻し終えるまでは書かない）と戻し方（前回の順番・表示していた文書・消されたファイルとフォルダ・許可が要るとき・フォルダを開けないブラウザ）・下書きを保存できないとき（保存先が容量超過を返す）の印と閉じる前の警告の対象、kvDraftStore・kvSessionStore が保存の成否を返すこと */
            objective {
                verify ResumeSessionReq;
                verify OpenSaveReq;
                verify NewSaveAsReq;
                verify MultiDocReq;
                verify DirtyReq;
                verify ConflictReq;
                verify ExternalChangeReq;
                verify UntitledDraftReq;
                verify NoOpenFileReq;
                verify LayoutReq;
                verify UnsavedLayoutReq;
                verify NoSilentWriteReq;
            }
        }
        verification def SessionTest {
            doc /* web/src/workspace/session.test.ts：起動したときの始め方（前回の続きが無い・フォルダを開いていなかった・許可が残っている・許可が要る・拒否・前回のフォルダを覚えていない・設定でサンプルを開く）、覚える文書と戻す順番・表示する文書、戻した後に表示するもの、手を付けていないサンプル、壊れた保存の読み込み */
            objective {
                verify ResumeSessionReq;
                verify NoOpenFileReq;
            }
        }
        verification def AutoSaveTest {
            doc /* web/src/workspace/workspace.test.ts（AutoSaver）：編集が止まってから 1 秒後に保存、無効・無題・競合のときは保存しない、保存できなかったとき（書き込みが例外を投げる）は理由を知らせて未保存の印を残す */
            objective {
                verify AutoSaveReq;
            }
        }
        verification def SavedTabsTest {
            doc /* web/src/app/saved-tabs.test.ts：記憶した図のタブの読み込み（JSON でない・配列でない・null の項目・id が整数でない・知らないビュー・ctx や phase の型違い・文字列でない mv・重なった id・表示中のタブが無い）。形の合わない項目だけを捨てる */
            objective {
                verify ViewTabsReq;
            }
        }
        verification def UnexpectedErrorTest {
            doc /* web/src/app/unexpected.test.ts：捕まえていない例外と結果を待たない処理の失敗を 1 回ずつ知らせ、詳しい内容をコンソールに残す。web/src/app/dom.test.ts：localStorage に書けたか（容量超過・使えない環境）を store が返す。web/src/app/recovery.test.ts：起動に失敗したときの案内の文（初期化して読み直す操作・消えないものの説明・失敗の内容のエスケープ） */
            objective {
                verify NoSilentFailureReq;
                verify UntitledDraftReq;
            }
        }
        verification def ErrorTextTest {
            doc /* web/src/app/error-text.test.ts：ブラウザのエラー（NotAllowedError・NotFoundError・QuotaExceededError・TypeMismatchError・AbortError・NoModificationAllowedError・InvalidStateError・NotReadableError）ごとの日本語の文、
                   分からないエラー（知らない名前の DOMException・TypeError・メッセージの無い Error・Error でない値）の一般的な文、Modelith のエラー（日本語のメッセージ・ConflictError）はそのまま */
            objective {
                verify PlainWordsReq;
                verify NoSilentFailureReq;
            }
        }
        verification def RobustE2E {
            doc /* web/e2e/robust.spec.ts：壊れた図のタブの記憶があっても起動して形の合う項目だけ戻す、ブラウザの保存領域がいっぱいのときの下書きの知らせ（1 回）と閉じる前の警告、自動保存に失敗したときの知らせ（ブラウザのエラーは日本語の文で）と未保存の印、予期しない例外の知らせ、起動の途中で失敗したときの「保存した設定を初期化して読み直す」（下書きは残る）（Chromium で操作） */
            objective {
                verify ViewTabsReq;
                verify UntitledDraftReq;
                verify DirtyReq;
                verify AutoSaveReq;
                verify NoSilentFailureReq;
                verify PlainWordsReq;
            }
        }
        verification def DiagramsE2E {
            doc /* web/e2e/diagrams.spec.ts：「新しい図を作成…」で種類を選ぶ（空の一般の図・内部ブロック図のブロックを選ぶ・対象が無ければ新しく作る・やめると何も変えない）と、
                   サイドバーの「図」（並べて開く・図が無いときの案内・名前の変更と配置の保持・既にある名前の拒否・削除の確認と要素の保持・ツリーの右クリックからの名前の変更）（Chromium で操作） */
            objective {
                verify CreateViewReq;
                verify ViewListReq;
            }
        }
        verification def DiagramKindsTest {
            doc /* web/src/app/diagram-kinds.test.ts：作成できる図の種類と描く対象の定義の種類、対象の候補（種類の合う定義を名前の順に）、図の名前を変えたときの配置とタブの付け替え */
            objective {
                verify CreateViewReq;
                verify ViewListReq;
            }
        }
        verification def ViewsE2E {
            doc /* web/e2e/views.spec.ts：8 つのビュー・テキストの view（一般ビューの特殊化・依存・割り当ての線と多重度、内部ブロック図の結び付け・n 項の接続・部品の中の部品、一般ビューのメモとその削除・インスペクタのメモと別の言語での表し方、アクティビティ図の記号・ガード・順序付きの流れ・順序の線の削除と追加・ツリーから開く・アクション定義ごとの配置、状態遷移図の記号・入れ子と並行の領域・遷移のラベル・遷移の削除と追加・ツリーから開く（＋メニューの組み込みのビューは 8 つのまま）・状態定義ごとの配置・「振る舞い」の図の一般ビューとしての保存、シーケンス図のイベント（入れ子の部品のものも）とイベントの間の順序の線・その選択と削除、filter の論理式と render の合成形の view、内部ブロック図の 3 段の連鎖の端と見つからない段・対象の枠の上のポートとその線の削除、アクティビティ図のパラメータと流れとその削除、入れ子の本体を含む）・図の保存と図に入れる・外す・タブ・拡大と範囲選択・テキストからの反映・問題一覧・ツリー・フェーズ・トレースの抜け（図を見ているときは図の要素を選んで中央に出し、足りない関係の案内と「関係を追加」を示す・案内から検証をつなぐと抜けが減る・何件目かの表示と前後への移動・短い名前の無い要求の名前を 1 回だけ書いた抜けの文・テキストを見ているときと「テキストで見る」ではテキストの行へ・問題一覧の抜けの行から図の要素へ・幅 390px・抜けのある要素の △ の印・キーボードでの操作）・図の種類のツールチップ（＋メニュー・タブ・作成した図のサブバー）と狭い画面の＋メニューに添える SysML v2 の標準ビューの名前（Chromium で操作） */
            objective {
                verify ActivityDiagramReq;
                verify InterconnectionDiagramReq;
                verify PlainWordsReq;
                verify CreateViewReq;
                verify StandardViewReq;
                verify SequenceReq;
                verify NoSilentDropReq;
                verify BuiltInViewsReq;
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
            doc /* web/e2e/editing.spec.ts：図からの追加と削除・要求をつなぐ関係の追加（要求 → 検証・検証 → 要求の «verify»、要求 → 部品の «satisfy»、要求どうしの導出の逆向き）・名前変更（日本語の名前は引用名で書く・「'」は断る）・説明（要求の文章）の書き換え・足す・消す・やめる・属性の追加・値の書き換え・削除・「;」を含む値を断る・配置ファイルへの保存（テキストには書かない）・古い @layout の読み込みと移行・「配置は未保存」と保存先の選択・配置も含めたファイルごとの元に戻す・package の無いファイルでの案内 */
            objective {
                verify EditDetailsReq;
                verify DiagramToTextReq;
                verify NewPackageGuideReq;
                verify RenameReq;
                verify LayoutReq;
                verify UnsavedLayoutReq;
                verify NoSilentWriteReq;
                verify UndoReq;
                verify TextIsSourceReq;
            }
        }
        verification def WordHelpE2E {
            doc /* web/e2e/words.spec.ts：キーワードと標準ライブラリの型にマウスを乗せたときのツールチップ、コメントの中の語と利用者の付けた名前では出さないこと、クリックとキー操作で動かしたカーソルのある語の説明の行、幅 390px のテキストの読み取り専用と「編集」ボタンでの切り替え、画面の幅を変えたときの戻り方、ダブルタップの案内とダブルタップでの語の選択と説明（Chromium のタッチで操作） */
            objective {
                verify WordHelpReq;
                verify PhoneTextReq;
                verify NarrowScreenReq;
                verify PlainWordsReq;
            }
        }
        verification def MobileE2E {
            doc /* web/e2e/mobile.spec.ts：iPhone（devices["iPhone 13"]、WebKit）と Android（devices["Pixel 5"]、Chromium）の端末の設定で、テキストの読み取り専用とダブルタップの案内、「編集」のタップでの切り替え、ダブルタップでの語の選択と説明（キーワードと標準ライブラリの型） */
            objective {
                verify PhoneTextReq;
                verify WordHelpReq;
                verify NarrowScreenReq;
            }
        }
        verification def FilesE2E {
            doc /* web/e2e/files.spec.ts・fallback.spec.ts：OPFS の本物のハンドルでフォルダ・保存・切り替え・離脱時の警告・自動保存・競合（テキストと配置ファイル）・読み直し・前回のフォルダ・下書き・最後のファイルを閉じた後の画面・前回の続き（再読み込みでフォルダとファイル・表示していたファイル・図のタブから始まる、許可が要るときの「前回の続きを開く」と許可が得られないとき、待つ間の別の操作、消されたファイル、設定「起動時にサンプルを開く」、幅 390px）、代替のブラウザ（モデルと配置ファイルを組でダウンロード・一緒に選んで開く・下書きと表示していたファイルから始まる）、テキストを読み取る部品（wasm）を読み込めないときの案内 */
            objective {
                verify UnsavedLayoutReq;
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
                verify NoOpenFileReq;
                verify ResumeSessionReq;
            }
        }
        verification def ExportFileTest {
            doc /* web/src/app/export-file.test.ts：エクスポートの形式の一覧（SVG 画像・draw.io の順、知らない ID は既定）と、ファイル名の決め方（拡張子なし・同じ拡張子・違う形式の拡張子の付け替え・大文字・形式の拡張子でない点・空・空白だけ・拡張子だけ・前後の空白・パス区切り・使えない文字・末尾の点・既定の名前も空）。
                   web/src/app/export.test.ts：.drawio のファイルの包み方（根の 2 つのセル・図形が 0 個・図の名前の記号の文字参照） */
            objective {
                verify SvgExportReq;
                verify DrawioExportReq;
            }
        }
        verification def ShellE2E {
            doc /* web/e2e/shell.spec.ts：外部に通信しない・Content-Security-Policy が外部への通信とインラインのスクリプトを止める・ソースへのリンク・開発段階の表示・著作権とライセンスと商標の表示・狭い画面・ファイルのメニューの「エクスポート…」（既定の名前・入力した名前の SVG のダウンロード・draw.io を選ぶと拡張子が替わり mxfile のファイルになる・「やめる」では何もダウンロードしない）。e2e はすべてビルドした静的ファイルをそのまま配信して動かす */
            objective {
                verify PrivacyReq;
                verify ContentPolicyReq;
                verify SourceOfferReq;
                verify NarrowScreenReq;
                verify SvgExportReq;
                verify DrawioExportReq;
                verify StaticHostingReq;
                verify LegalNoticeReq;
                verify TrademarkReq;
                verify StageNoticeReq;
            }
        }
        verification def VisualUITest {
            doc /* web/e2e/visual.spec.ts：8 つのビュー・アクティビティ図（ActionFlowView）・状態遷移図（StateTransitionView。幅 390px を含む）・シーケンス図（SequenceView のイベントと順序。幅 390px を含む）・幅 390px・メニュー（ファイル・表示（線の形を含む）・ヘルプのメニュー、幅 390px の ☰ のメニューとその表示のメニュー、＋メニューのテキストの view と、幅 390px の＋メニューの SysML v2 の名前の行を含む）・インスペクタ・右クリックメニュー・エクスプローラー・開いているファイルが無いときの画面・「前回の続きを開く」（幅 390px を含む）・競合ダイアログ・問題一覧・トレースの絞り込みと抜け（図の要素の △ の印と、抜けの案内を出した図。幅 390px を含む）・画面の言葉（package を作る案内・作成した図のメニュー）・マウスやキーボードで選んだ部品の見た目・テキストの語のツールチップ・幅 390px の読み取り専用のテキストでダブルタップした語の説明を、明るい／暗い配色で基準画像と比べる */
            objective {
                verify PlainWordsReq;
                verify MenuBarReq;
                verify StandardViewReq;
                verify SequenceReq;
                verify BuiltInViewsReq;
                verify NarrowScreenReq;
                verify LookReq;
                verify CanvasReq;
                verify OpenFolderReq;
                verify OpenSaveReq;
                verify NoOpenFileReq;
                verify ResumeSessionReq;
                verify ConflictReq;
                verify ProblemsReq;
                verify PhaseReq;
                verify TraceGapReq;
                verify SourceOfferReq;
                verify WordHelpReq;
                verify PhoneTextReq;
            }
        }
        verification def KeyboardTest {
            doc /* web/src/app/keyboard.test.ts：ダイアログの中で Tab を回す先（最後から次・先頭から前・途中・1 つだけ・外から入る・0 個）と、図のタブを移る先（左右の矢印キー・両端で回る・Home・End・1 つだけ・移さないキー・タブの外）と、Tab でツリーに入る行（選んでいる行・先頭・末尾・選んでいなければ先頭・1 行・0 行） */
            objective {
                verify KeyboardReq;
            }
        }
        verification def KeyboardE2E {
            doc /* web/e2e/keyboard.spec.ts：ダイアログを開いている間は Tab・Shift+Tab で外へ出ず背景が inert になり、Esc で閉じると開いたボタンへ入力が戻る。
                   開いているファイルが無いときにメニューから開いたダイアログを閉じると、メニューの見出しへ入力が戻り、図とテキストは操作できないまま。
                   エクスポートはダイアログの役割と見出しを持ち、入力はファイル名の欄に置き、Esc で閉じるとファイルのメニューへ入力が戻る。
                   ファイル・ヘルプのメニューは Esc で閉じ、見出しへ入力が戻る。Tab で選んでいる図のタブに入り、左右の矢印キー（両端で回る）・Home・End で切り替わる。
                   モデルツリーには検索欄から Tab で入り（選んでいる行、無ければ先頭の行）、下の矢印キーで次の行へ移る（Chromium で操作） */
            objective {
                verify KeyboardReq;
                verify NoOpenFileReq;
                verify DrawioExportReq;
                verify ViewTabsReq;
                verify TreeReq;
            }
        }
        verification def MenuBarTest {
            doc /* web/src/app/keyboard.test.ts：メニューバーで左右の矢印キーを押したときに移る先のメニュー（左右・両端で回る・1 つだけ・移さないキー・0 個と範囲外）と、
                   開いているメニューで上下の矢印キーを押したときに移る先の項目（上下・両端で回る・見出しから入る・押せない項目を飛ばす・1 つだけ・0 個・移さないキー） */
            objective {
                verify MenuBarReq;
            }
        }
        verification def MenuBarE2E {
            doc /* web/e2e/menubar.spec.ts：左にロゴ・メニュー（ファイル・編集・表示・図・プラグイン・ヘルプの順）・元に戻す・やり直す、右に同期の状態と開発段階の札が並ぶ。
                   1 つ開くとほかは閉じ、開いている間はマウスを乗せた見出しへ切り替わる（開いていなければ開かない）。左右の矢印キーで隣のメニューへ（両端で回る）、上下の矢印キーで項目へ（押せない項目を飛ばす）移り、Esc で閉じて見出しへ入力が戻る。
                   編集のメニューの元に戻す・やり直す・すべて選択、表示のメニューのパネル・拡大・全体図と「線の形」（直角・曲線を選ぶと図のツールバーのボタンとそろい、ツールバーで切り替えると ✓ が移り、読み込み直しても残り、上下の矢印キーで移れ、幅 390px でも選べる）。図のメニューに線の描き方の項目は無い。開いているファイルが無いときは図の操作の項目と、ファイルのメニューの「エクスポート…」を押せない。
                   幅 761・800・1000・1001px で見出しがはみ出さず、ヘルプが画面に収まる。幅 390px では ☰ にまとまり、縦に並んだメニューが横にはみ出さず、Esc で閉じて ☰ へ入力が戻り、☰ から開いたダイアログを閉じると ☰ へ戻る（Chromium で操作） */
            objective {
                verify MenuBarReq;
                verify KeyboardReq;
                verify NarrowScreenReq;
                verify NoOpenFileReq;
                verify SvgExportReq;
                verify DrawioExportReq;
            }
        }
        verification def LayoutTest {
            doc /* web/src/app/layout.test.ts・layout-file.test.ts：配置情報の読み書きと、配置ファイルの書式（キー順の固定・要素ごとに 1 行・壊れたファイル） */
            objective {
                verify LayoutReq;
            }
        }
        verification def ProjectFileTest {
            doc /* crates/modelith-core/src/project_file：プロジェクトの設定ファイル（modelith.json）の読み取り（名前・使うプラグインと既定値・知らない項目を残して書き戻す・JSON の誤りと型の誤りの行と列・空のテキスト）と作成。crates/modelith-wasm：結果の JSON での受け渡し。web/src/core/client.test.ts：コア（Worker）への読み取りと作成の依頼（コアが壊れた返事をしても例外を投げない）。web/src/files/local-folder.test.ts：開いたフォルダの中のファイルの読み書き（偽のファイルシステムで）。web/src/workspace/workspace.test.ts：フォルダを開く・一覧の更新で読み、「プロジェクトにする」で書く（既にあれば上書きしない）。web/src/app/project.test.ts：見出しに出す名前と、問題の知らせ方。web/e2e/project.spec.ts：プロジェクト名の表示・前回のフォルダと一覧の更新・「プロジェクトにする」とやめたとき・設定ファイルの無いフォルダ・誤りと知らない項目の知らせ（OPFS で） */
            objective {
                verify ProjectReq;
            }
        }
        verification def SettingsLevelTest {
            doc /* crates/modelith-core/src/project_file：「プロジェクトにする」で作る modelith.json には、このプロジェクトの設定（名前・使うプラグイン）だけを書き、
                   見た目と操作の好み（パネルの表示・幅・自動保存・起動時にサンプルを開く・線の描き方）は書かない（create_writes_pretty_json_with_the_name・create_trims_the_name_and_omits_an_empty_one）。
                   modelith.json の知らない項目は残して知らせる（parse_keeps_unknown_keys_and_warns_with_their_positions）。自分の設定はこのブラウザ（localStorage）にだけ置く（web/src/app/panels.ts の modelith-ui-v1 ほか） */
            objective {
                verify SettingsLevelReq;
            }
        }
        verification def RuleEngineTest {
            doc /* crates/modelith-core/src/rules：v0 の検査ルール（YAML）の読み込みと検査。読み込み：マニフェスト（JSON の誤り・知らない項目・対応しない apiVersion・runtime が rules でない・ID の食い違い・入っていないプラグイン）とルールのファイル（YAML の誤り・知らない項目・欠けた項目・知らない重さ・ルールの ID の形と重複・正規表現の誤り・ポートの数の下限と上限・空の種類・知らない要素や関係の種類・プラグインのフォルダの外を指すパス）を、ファイルと行・列つきで知らせ、誤りの無いルールは使う。検査：要素の種類・工程・名前で当て、受ける関係・出す関係・名前・工程・ポートの数・否定（not）・空の条件を確かめ、満たさない要素ごとに、プラグインとルールの ID・重さ・名前と種類を差し込んだ文・行と列（UTF-16）を返す */
            objective {
                verify RuleCheckReq;
                verify PluginErrorReq;
            }
        }
        verification def PluginHostTest {
            doc /* crates/modelith-core/src/rules：画面から渡されたプラグインのファイルからの読み込み（入っているか・マニフェストの名前と版と種類）。crates/modelith-core/src/project_file：使うプラグインの項目の書き換え（加える・使う／止める・外す。知らない項目と設定を残す・無い項目・読めない設定ファイル・形の正しくない ID）。crates/modelith-wasm：Worker が持つプラグイン（まとめ・有効なものだけを当てる・入っていないプラグイン・読めない入力）と、解析結果に付けた検査の結果の JSON。web/src/core/client.test.ts：コア（Worker）へのプラグインの受け渡しと、編集に追従する検査の結果（コアが壊れた返事をしても例外を投げない）。web/src/app/plugins.test.ts：一覧の状態・問題一覧の文（プラグインとルールを添える・ファイルと行を添える・足りないプラグインの案内）・追加の確認と写す計画。web/src/files/local-folder.test.ts：プラグインのフォルダを読む・消す・フォルダの外を指すパスを断る（偽のファイルシステムで） */
            objective {
                verify RuleCheckReq;
                verify PluginErrorReq;
                verify MissingPluginReq;
            }
        }
        verification def PluginE2E {
            doc /* web/e2e/plugins.spec.ts：プロジェクトに入れた検査ルールの結果を、プラグインとルールを添えて問題一覧に示し、押すとその行に移り、編集で直すと消える・壊れたルールのファイルをファイルと行で知らせる・入っていない／版が違うプラグインの案内から追加する。同じファイルで、プラグインのフォルダの追加・止める・また使う・削除と、プロジェクトが無いときの案内も確かめる（OPFS で）。
                   このブラウザ：プロジェクトを開いていても追加先に「このブラウザ」を選べてプロジェクトには書かない・同じ ID のプラグインがプロジェクトにもあればプロジェクトのものを使い「プロジェクトを優先」と示す・フォルダを開けないブラウザ（fsAccess=false）では「このブラウザ」にだけ追加できると示し、フォルダを選ぶ入力欄で選んだチェックルールのプラグインを追加して、無効にし、また有効にし、開き直しても使える。
                   web/e2e/script-plugins.spec.ts：フォルダを開けないブラウザで TypeScript のプラグインを「このブラウザ」に追加して許可して動かす・削除するときにプラグインが保存したデータも削除するかを選べる。web/e2e/visual.spec.ts：追加先を選ぶ追加の確認と、このブラウザのプラグイン（実行中・プロジェクトを優先）を含む一覧の見た目（明るい・暗い配色） */
            objective {
                verify RuleCheckReq;
                verify PluginErrorReq;
                verify MissingPluginReq;
                verify PluginListReq;
            }
        }
        verification def ScriptPluginHostTest {
            doc /* crates/modelith-core/src/plugin_host：プラグインから届いたメッセージを plugin-sdk の型で読む（知らない種類・欠けた項目・負の番号を断る）・権限の要るメッセージ（診断は model:read、変更案は edits:propose、保存場所は storage）を宣言していなければ断る・変更案と診断の範囲を UTF-16 の位置に直す（行末・行の長さ + 1・最終行 + 1・サロゲートペアの途中・逆向き・重なり・同じ位置から始まる 2 つ・空）・プラグインに渡すモデル（要素の範囲・ポートの型と向き・関係の種類）。crates/modelith-core/src/rules：runtime が browser のプラグインの読み込み（main が無い・フォルダの外・ファイルが無い）。crates/modelith-wasm：確かめた結果とモデルの JSON。web/src/core/client.test.ts：コア（Worker）への確認の依頼と、その間にテキストが変わったときの印。web/src/plugins/messages.test.ts：確かめたメッセージの扱い（版が同じ変更案だけを当てる・古い版と確かめる間の変更は断って知らせる・頼んでいない答え・保存場所の依頼・古い診断）。web/src/plugins/trust.test.ts：許可を尋ね直す条件（初めて・権限が 1 つ増えた・減った・入れ替えた・外部と通信できるプラグインのファイルとバージョンの変更・通信できないものの変更・許可しなかったもの）と覚える形。web/src/plugins/permissions.test.ts：隔離用のページの CSP（2 つのページは connect-src だけが違う）と、プラグインのコードより先に EventSource・Worker・SharedWorker を消すこと。web/src/app/plugins.test.ts：追加の確認に権限と外部への送信の注意を出す・動かすプラグインの選び方・追加先の選択肢（このプロジェクトに追加できない場面の理由・既定の追加先・上書きと優先の説明）・このブラウザのプラグインの行と優先（modelith.json に同じ ID があれば無効・未追加でもプロジェクトを優先）・コアに渡すものと動かすもの・削除の確認（保存したデータを尋ねる条件）・フォルダを選ぶ入力欄のパス。
                   web/src/plugins/messages.test.ts：インポート・エクスポートの答え（頼んだ種類と番号のものだけを使う・種類の食い違い・上限ちょうどと上限を超える大きさ・base64 でない中身・形の正しくない MIME タイプ）と失敗の知らせ。web/src/plugins/transfer.test.ts：base64 の確かめと変換（区切りを超える長さ・空）・新しい文書の名前（拡張子・重なる名前の番号・パスと使えない文字・名前が残らない）・ダウンロードの名前と種類。web/src/plugins/storage.test.ts：保存場所の更新（足す・置き換える・null で消す・上限ちょうどと上限 + 1 バイト・壊れた保存内容）と読み出し。web/src/plugins/view.test.ts：メニューのインポート・エクスポートの項目（拡張子での絞り込み・実行中のものだけ） */
            objective {
                verify PluginEditReq;
                verify PluginTrustReq;
                verify PluginSandboxReq;
                verify ScriptPluginReq;
                verify PluginListReq;
            }
        }
        verification def ScriptPluginE2E {
            doc /* web/e2e/script-plugins.spec.ts（基準のブラウザ、OPFS で）：コマンドが提案した変更を当てて 1 回の「元に戻す」で取り消す・古いテキストへの変更を断って知らせる・宣言していない権限の変更案を使わず一覧で知らせる・診断をプラグインを添えて問題一覧に出し直すと消える。外部との通信を宣言していないプラグインの fetch・XMLHttpRequest・WebSocket・EventSource・importScripts がすべて失敗し、テストのサーバに何も届かない・ブラウザの保存場所と親の画面に触れられない（宣言して許可したものだけが通信できる）。止まらない処理をしても画面が動き、停止できる（この隔離の 3 つは Chromium・Firefox・WebKit で、このブラウザに追加したプラグインで確かめる）。初めて動かす前に名前・ID・バージョン・権限を示して尋ね、外部と通信できるものはそのことを示す・開き直しても尋ねない・権限が増えた・通信できるプラグインのファイルが変わったら尋ね直す・通信できないものは尋ねない・許可しなかったものを一覧から許可する・追加の確認で権限を示す。
                   インポート：選んだファイルからプラグインが作ったテキストを新しいファイルとして開き、開いていたファイルとフォルダは書き換えない・プラグインが失敗を返せば理由を示す。エクスポート：プラグインが返したファイルを、拡張子を補った名前でダウンロードさせ、フォルダには書かない・作成した図を表示していればその名前を渡す。
                   保存場所：storage を宣言したプラグインが読み書きでき、開き直しても残る・1 MB を超える値は保存せず知らせる・宣言していなければ使わず一覧で知らせる。web/e2e/visual.spec.ts：許可のダイアログと実行中のプラグインの一覧の見た目 */
            objective {
                verify PluginEditReq;
                verify PluginTrustReq;
                verify PluginSandboxReq;
                verify ScriptPluginReq;
                verify PluginListReq;
            }
        }
        verification def PluginLimitsTest {
            doc /* web/src/plugins/limits.test.ts：届いたメッセージの入口の判断（大きさの上限ちょうどと + 1・待ちの件数の上限 - 1 と上限・捨てた数が上限に達したら止める・入れ子と循環するデータ）、知らせの頻度（1 秒に 5 件目と 6 件目・1 秒たてば数え直す）、
                   期限の判断（期限 - 1 ミリ秒と + 1 ミリ秒）と、終わらないときの知らせの文。web/src/plugins/messages.test.ts：診断の件数の上限（上限ちょうどと + 1 件）。web/src/plugins/transfer.test.ts：エクスポートの名前を宣言した拡張子に合わせる（同じ拡張子・違う拡張子・拡張子なし・パス付き・大文字） */
            objective {
                verify PluginSandboxReq;
                verify PluginListReq;
                verify ScriptPluginReq;
            }
        }
        verification def PluginLimitsE2E {
            doc /* web/e2e/script-plugins.spec.ts：大量の知らせを送るプラグインがあっても画面は動き、超えた分を捨てたことと止めたことを一覧で知らせる。止まらないコマンドと、起動が終わらないプラグインは、期限がきたらトーストと一覧の行で知らせ、一覧の「停止」で止められる */
            objective {
                verify PluginSandboxReq;
                verify PluginListReq;
            }
        }
        verification def MultiFileWebTest {
            doc /* web/src/workspace/project-files.test.ts・workspace.test.ts：フォルダのモデルのファイルを読み、開いている文書は編集中のテキストを使い、他のアプリでの変更と保存した中身を入れること、送る変更の計算。
                   web/src/core/client.test.ts：コアに覚えさせたほかのファイルの定義を参照した要素だけを描き、ファイルのパスを持つこと、表示中のファイルと同じパスのファイルはつながないこと、
                   ほかのファイルの要素を書き換えようとするとファイルのパスを添えて断ること、忘れさせたファイルの定義は見つからなくなること。web/src/app/svg.test.ts：ファイル名の札。
                   web/e2e/multi-file.spec.ts：フォルダを開き、import したほかのファイルの定義を札付きで描くこと、選ぶとそのファイルを開けること、消そうとすると書き換えずにそのファイルを案内すること、
                   ほかのファイルの編集が表示に戻ったときの図に入ること（ADR-0021） */
            objective {
                verify MultiFileModelReq;
            }
        }
        verification def CliCheckTest {
            doc /* crates/modelith-cli/tests/check.rs：ビルドした modelith check <フォルダ> を一時的なフォルダのプロジェクトに対して動かし、modelith.json の有効なプラグインのルールで .sysml・.kerml を検査する（隠しフォルダ・target・node_modules は見ない）。結果をパス・行・列の順に 1 行ずつ出し、誤りがあれば 1、注意だけなら 0、使い方の誤りは 2 で終わる。壊れたルール・入っていないプラグイン・フォルダの外を指すパス・壊れた modelith.json・シンボリックリンクのルールのファイルと modelith.json は誤りとして知らせる（シンボリックリンクを作れない環境では飛ばす）。フォルダのファイルを 1 つのモデルとして検査し、ほかのファイルに書いた関係も数えること（ADR-0021）。crates/modelith-cli/src：出力の行とまとめの形、検査するファイルの選び方、シンボリックリンクを読まないこと */
            objective {
                verify RuleParityReq;
                verify MultiFileModelReq;
            }
        }
    }
}
