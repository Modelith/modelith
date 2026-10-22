//! プラグインから届いたメッセージを確かめる（ADR-0018 §3：形と権限。§4：変更案の範囲）。

use modelith_plugin_protocol::{
    Diagnostic, DiagnosticSeverity, Permission, PluginMessage, TextEdit,
};
use serde::Serialize;

use super::position::Positions;

/// 画面の位置（UTF-16 のオフセット）に直した変更 1 つ。古いテキストの `[start, end)` を `text` に置き換える。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlacedEdit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// 画面の位置（UTF-16 のオフセット）に直した診断 1 つ。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlacedDiagnostic {
    pub pos: usize,
    pub end: usize,
    pub severity: DiagnosticSeverity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// 確かめたメッセージ。変更案と診断は、位置を画面の位置に直したものを添える。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CheckedMessage {
    pub message: PluginMessage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edits: Option<Vec<PlacedEdit>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<PlacedDiagnostic>>,
}

/// メッセージを使うのに要る権限（ADR-0018 §3 の表）。
///
/// # 引数
///
/// - `message`：プラグインからのメッセージ
///
/// # 戻り値
///
/// 要る権限。権限の要らないメッセージ（`ready`・`commandDone`・`failed`・`notify`・取り込みと書き出しの結果）は `None`。
///
/// # 例
///
/// ```text
/// required_permission(proposeEdits) → Some(EditsPropose)
/// required_permission(diagnostics)  → Some(ModelRead)
/// required_permission(storageGet)   → Some(Storage)
/// required_permission(ready)        → None
/// ```
pub fn required_permission(message: &PluginMessage) -> Option<Permission> {
    match message {
        PluginMessage::Diagnostics { .. } => Some(Permission::ModelRead),
        PluginMessage::ProposeEdits { .. } => Some(Permission::EditsPropose),
        PluginMessage::StorageGet { .. } | PluginMessage::StorageSet { .. } => {
            Some(Permission::Storage)
        }
        PluginMessage::Ready
        | PluginMessage::CommandDone { .. }
        | PluginMessage::Imported { .. }
        | PluginMessage::Exported { .. }
        | PluginMessage::Failed { .. }
        | PluginMessage::Notify { .. } => None,
    }
}

/// プラグインから届いたメッセージ（JSON）を、契約の型で読み、宣言した権限で許されるかを確かめ、
/// 変更案と診断の範囲を `text` の位置に直す。
///
/// # 引数
///
/// - `text`：今のテキスト全体（変更案・診断の範囲を確かめる）
/// - `json`：プラグインから届いたメッセージの JSON
/// - `permissions`：マニフェストで宣言した権限
///
/// # 戻り値
///
/// 確かめたメッセージ。形が正しくない・権限が無い・範囲がおかしいときは、プラグインの一覧に出す理由の文を `Err` で返す。
///
/// # 例
///
/// ```text
/// check_message("ab", r#"{"type":"ready"}"#, &[]) → Ok({ message: Ready })
/// check_message("ab", r#"{"type":"proposeEdits","version":1,"edits":[…0:0–0:1 → "A"…]}"#, &[EditsPropose])
///   → Ok({ message: ProposeEdits{…}, edits: [{ start: 0, end: 1, text: "A" }] })
/// check_message("ab", 同じ変更案, &[]) → Err("宣言していない権限（edits:propose）が要るメッセージ（proposeEdits）のため、使いませんでした")
/// check_message("ab", r#"{"type":"shutdown"}"#, &[]) → Err("形が正しくないメッセージのため、使いませんでした（…）")
/// ```
pub fn check_message(
    text: &str,
    json: &str,
    permissions: &[Permission],
) -> Result<CheckedMessage, String> {
    let message: PluginMessage = serde_json::from_str(json)
        .map_err(|e| format!("形が正しくないメッセージのため、使いませんでした（{e}）"))?;
    let missing = required_permission(&message).filter(|need| !permissions.contains(need));
    if let Some(need) = missing {
        return Err(format!(
            "宣言していない権限（{}）が要るメッセージ（{}）のため、使いませんでした",
            permission_name(need),
            message_type(&message)
        ));
    }
    let edits = match &message {
        PluginMessage::ProposeEdits { edits, .. } => Some(resolve_edits(text, edits)?),
        _ => None,
    };
    let diagnostics = match &message {
        PluginMessage::Diagnostics { items, .. } => Some(place_diagnostics(text, items)?),
        _ => None,
    };
    Ok(CheckedMessage {
        message,
        edits,
        diagnostics,
    })
}

/// 変更案の範囲を確かめ、画面の位置に直す（ADR-0018 §4）。範囲はテキストの中にあり、互いに重ならないこと。
/// 同じ位置から始まる変更が 2 つあると当てる順が決まらないので、それも重なりとして断る。
///
/// # 引数
///
/// - `text`：変更を当てるテキスト全体
/// - `edits`：変更案（行・列。列は UTF-16）
///
/// # 戻り値
///
/// 始まりの順に並べた変更。範囲がテキストの外・始まりが終わりより後ろ・重なりがあれば、理由の文を `Err` で返す。
///
/// # 例
///
/// ```text
/// resolve_edits("abc", [1:0–… は外])                 → Err("変更案の範囲がテキストの外を指しているため、適用しませんでした")
/// resolve_edits("abc", [0:2–0:3 → "C", 0:0–0:1 → "A"]) → Ok([{0,1,"A"}, {2,3,"C"}])
/// resolve_edits("abc", [0:0–0:2, 0:1–0:3])            → Err("変更案の範囲が重なっているため、適用しませんでした")
/// resolve_edits("abc", [])                            → Ok([])
/// ```
pub fn resolve_edits(text: &str, edits: &[TextEdit]) -> Result<Vec<PlacedEdit>, String> {
    let positions = Positions::new(text);
    let mut placed = Vec::with_capacity(edits.len());
    for e in edits {
        let (start, end) = (
            positions.offset(e.range.start),
            positions.offset(e.range.end),
        );
        let (Some(start), Some(end)) = (start, end) else {
            return Err(
                "変更案の範囲がテキストの外を指しているため、適用しませんでした".to_owned(),
            );
        };
        if start > end {
            return Err(
                "変更案の範囲の始まりが終わりより後ろにあるため、適用しませんでした".to_owned(),
            );
        }
        placed.push(PlacedEdit {
            start,
            end,
            text: e.new_text.clone(),
        });
    }
    placed.sort_by_key(|e| (e.start, e.end));
    if placed
        .windows(2)
        .any(|w| w[1].start < w[0].end || w[1].start == w[0].start)
    {
        return Err("変更案の範囲が重なっているため、適用しませんでした".to_owned());
    }
    Ok(placed)
}

/// 診断の範囲を確かめ、画面の位置に直す。
///
/// # 引数
///
/// - `text`：診断の対象のテキスト全体
/// - `items`：診断（行・列。列は UTF-16）
///
/// # 戻り値
///
/// 届いた順の診断。範囲がテキストの外・始まりが終わりより後ろのものがあれば、理由の文を `Err` で返す。
///
/// # 例
///
/// ```text
/// place_diagnostics("a\nb", [1:0–1:1 warning "m"]) → Ok([{ pos: 2, end: 3, severity: Warning, message: "m" }])
/// place_diagnostics("a", [3:0–3:0 …])              → Err("診断の範囲がテキストの外を指しているため、使いませんでした")
/// place_diagnostics("a", [])                       → Ok([])
/// ```
pub fn place_diagnostics(
    text: &str,
    items: &[Diagnostic],
) -> Result<Vec<PlacedDiagnostic>, String> {
    let positions = Positions::new(text);
    items
        .iter()
        .map(|d| {
            match (
                positions.offset(d.range.start),
                positions.offset(d.range.end),
            ) {
                (Some(pos), Some(end)) if pos <= end => Ok(PlacedDiagnostic {
                    pos,
                    end,
                    severity: d.severity,
                    message: d.message.clone(),
                    code: d.code.clone(),
                }),
                _ => Err("診断の範囲がテキストの外を指しているため、使いませんでした".to_owned()),
            }
        })
        .collect()
}

/// 権限の名前（マニフェストに書く言葉）。
///
/// # 引数
///
/// - `p`：権限
///
/// # 戻り値
///
/// `model:read`・`edits:propose`・`network`・`storage` のどれか。
///
/// # 例
///
/// ```text
/// permission_name(EditsPropose) → "edits:propose"
/// permission_name(Network)      → "network"
/// ```
fn permission_name(p: Permission) -> &'static str {
    match p {
        Permission::ModelRead => "model:read",
        Permission::EditsPropose => "edits:propose",
        Permission::Network => "network",
        Permission::Storage => "storage",
    }
}

/// メッセージの種類の名前（JSON の `type`）。
///
/// # 引数
///
/// - `m`：メッセージ
///
/// # 戻り値
///
/// `type` の値。
///
/// # 例
///
/// ```text
/// message_type(ProposeEdits{…}) → "proposeEdits"
/// message_type(StorageSet{…})   → "storageSet"
/// ```
fn message_type(m: &PluginMessage) -> &'static str {
    match m {
        PluginMessage::Ready => "ready",
        PluginMessage::Diagnostics { .. } => "diagnostics",
        PluginMessage::ProposeEdits { .. } => "proposeEdits",
        PluginMessage::CommandDone { .. } => "commandDone",
        PluginMessage::Imported { .. } => "imported",
        PluginMessage::Exported { .. } => "exported",
        PluginMessage::Failed { .. } => "failed",
        PluginMessage::StorageGet { .. } => "storageGet",
        PluginMessage::StorageSet { .. } => "storageSet",
        PluginMessage::Notify { .. } => "notify",
    }
}
