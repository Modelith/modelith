//! 読み込んだルールをモデルに当て、検査の結果を作る。

use std::collections::HashMap;

use super::{CheckRule, Condition, Finding, LoadedPlugin, Located, Target, load::byte_place};
use crate::edit::text::Utf16;
use crate::model::{Edge, Model, Node};
use crate::project::ParseResult;

/// 要素ごとの、受ける線と出す線の種類。
struct Links<'a> {
    incoming: HashMap<&'a str, Vec<&'a str>>,
    outgoing: HashMap<&'a str, Vec<&'a str>>,
}

impl<'a> Links<'a> {
    /// 線の一覧から、要素のキーごとの受ける線・出す線の種類の表を作る。
    ///
    /// # 引数
    ///
    /// - `edges`：モデルの線
    ///
    /// # 戻り値
    ///
    /// 要素のキー → 線の種類の一覧（受ける線・出す線それぞれ）。
    ///
    /// # 例
    ///
    /// ```text
    /// Links::new([satisfy A→R]) → incoming: { R: ["satisfy"] }、outgoing: { A: ["satisfy"] }
    /// Links::new([])            → どちらも空
    /// ```
    fn new(edges: &'a [Edge]) -> Self {
        let mut incoming: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
        for e in edges {
            incoming.entry(e.to.as_str()).or_default().push(e.kind);
            outgoing.entry(e.from.as_str()).or_default().push(e.kind);
        }
        Self { incoming, outgoing }
    }

    /// 要素が、いずれかの種類の線を受ける（`incoming` が真）か出す（偽）か。
    ///
    /// # 引数
    ///
    /// - `key`：要素のキー
    /// - `kinds`：線の種類（モデルの `Edge.kind`）
    /// - `incoming`：真なら受ける線、偽なら出す線を見る
    ///
    /// # 戻り値
    ///
    /// その種類の線が 1 本以上あれば true。
    ///
    /// # 例
    ///
    /// ```text
    /// // 線 satisfy A→R のとき
    /// has("R", ["satisfy"], true)  → true
    /// has("R", ["satisfy"], false) → false   // R は出していない
    /// has("R", [], true)           → false
    /// ```
    fn has(&self, key: &str, kinds: &[&str], incoming: bool) -> bool {
        let table = if incoming {
            &self.incoming
        } else {
            &self.outgoing
        };
        table
            .get(key)
            .is_some_and(|ks| ks.iter().any(|k| kinds.contains(k)))
    }
}

/// 読み込んだプラグインのルールをモデルに当て、`require` を満たさない要素ごとに結果を作る（ADR-0018 §2）。
///
/// # 引数
///
/// - `plugins`：読み込んだプラグイン（使えるルールだけを当てる）
/// - `parse`：モデルを作った解析結果（要素の宣言の位置を引く）
/// - `model`：`parse` から作ったモデル
///
/// # 戻り値
///
/// 検査の結果（プラグイン → ルール → 要素の順）。どのルールにも当たらなければ空。
///
/// # 例
///
/// ```text
/// // "package P { requirement def R; part def A; satisfy R by A; requirement def S; }"
/// // ルール：match.kind "requirement def"、require.incoming "satisfy"
/// check(…) → [Finding { rule: …, element: "S", … }]   // R は満たされている
/// check(&[], …) → []
/// ```
pub fn check(plugins: &[LoadedPlugin], parse: &ParseResult, model: &Model) -> Vec<Finding> {
    let links = Links::new(&model.edges);
    let mut found = Vec::new();
    for plugin in plugins {
        for rule in &plugin.rules {
            // ほかのファイルの要素は、そのファイルを検査するときに当てる（ADR-0021）
            for node in model.nodes.iter().filter(|n| n.file.is_none()) {
                if !matches_target(&rule.target, node) || holds(&rule.require, node, &links) {
                    continue;
                }
                found.push(finding(plugin, rule, node, parse));
            }
        }
    }
    found
}

/// テキストを解析してモデルを作り、ルールを当て、結果の位置を行・列にする（CLI と画面で同じ手順にする）。
/// プロジェクトのほかのファイルも渡すと、それとつないだモデル（ADR-0021）で、`text` の要素だけを検査する。
///
/// # 引数
///
/// - `text`：SysML v2 / KerML のテキスト全体
/// - `others`：プロジェクトのほかのファイルのテキスト（無ければ空）
/// - `plugins`：読み込んだプラグイン
///
/// # 戻り値
///
/// 位置（1 始まりの行・列。列は UTF-16）つきの検査の結果。並びは [`check`] と同じ。
///
/// # 例
///
/// ```text
/// check_text("package P {\n  requirement def S;\n}", &[], 上のルール) → [Located { place: { line: 2, column: 3 }, … }]
/// check_text("package P {\n  requirement def S;\n}", &["part def A; satisfy P::S by A;"], 上のルール) → []
/// check_text("", &[], 上のルール) → []
/// ```
pub fn check_text(text: &str, others: &[&str], plugins: &[LoadedPlugin]) -> Vec<Located> {
    let parse = crate::project::merge::project_files(text, others);
    let model = crate::model::build_whole(&parse);
    let utf16 = Utf16::new(text);
    check(plugins, &parse, &model)
        .into_iter()
        .map(|finding| Located {
            place: byte_place(text, utf16.byte(finding.pos)),
            finding,
        })
        .collect()
}

/// 結果 1 件を作る。
///
/// # 引数
///
/// - `plugin`：ルールのあるプラグイン
/// - `rule`：満たされなかったルール
/// - `node`：当たった要素
/// - `parse`：解析結果（要素の宣言の位置を引く）
///
/// # 戻り値
///
/// 文に名前と種類を差し込み、位置を宣言の始まりにした結果。
///
/// # 例
///
/// ```text
/// finding(jp.x, rule「{kind}「{name}」…」, part def A, …) → Finding { message: "part def「A」…", element: "A", … }
/// ```
fn finding(plugin: &LoadedPlugin, rule: &CheckRule, node: &Node, parse: &ParseResult) -> Finding {
    Finding {
        plugin: plugin.id.clone(),
        rule: rule.id.clone(),
        severity: rule.severity,
        message: fill_message(&rule.message, node),
        element: node.key.clone(),
        pos: parse.entries.get(node.entry).map_or(0, |e| e.start),
    }
}

/// 要素が `match` に当たるか（種類はいずれか、工程は等しい、名前は正規表現に当たる。書いたものすべて）。
///
/// # 引数
///
/// - `target`：ルールの `match`
/// - `node`：要素
///
/// # 戻り値
///
/// すべての条件を満たせば true。
///
/// # 例
///
/// ```text
/// matches_target(kind ["part def"], part def A)                 → true
/// matches_target(kind ["part def"], requirement def R)          → false
/// matches_target(kind ["part def"], phase "P1", 工程の無い A)    → false
/// ```
fn matches_target(target: &Target, node: &Node) -> bool {
    target.kinds.contains(&node.kind)
        && target
            .phase
            .as_ref()
            .is_none_or(|p| node.phase.as_ref() == Some(p))
        && target
            .name
            .as_ref()
            .is_none_or(|re| re.is_match(&node.name))
}

/// 要素が条件を満たすか（書いたものすべて。`not` は中の条件を満たさないこと）。
///
/// # 引数
///
/// - `c`：ルールの `require`（または、その中の `not`）
/// - `node`：要素
/// - `links`：要素ごとの線の種類
///
/// # 戻り値
///
/// すべての条件を満たせば true。何も書いていない条件は true。
///
/// # 例
///
/// ```text
/// holds(incoming ["satisfy"], 満たされた要求 R)  → true
/// holds(ports (1, None), ポートの無い A)          → false
/// holds(not {}, A)                                → false   // 空の条件の否定
/// holds({}, A)                                    → true
/// ```
fn holds(c: &Condition, node: &Node, links: &Links) -> bool {
    let key = node.key.as_str();
    let ports = u32::try_from(node.ports.len()).unwrap_or(u32::MAX);
    c.incoming.as_ref().is_none_or(|k| links.has(key, k, true))
        && c.outgoing.as_ref().is_none_or(|k| links.has(key, k, false))
        && c.name.as_ref().is_none_or(|re| re.is_match(&node.name))
        && c.phase.is_none_or(|p| p == node.phase.is_some())
        && c.ports.is_none_or(|(min, max)| {
            min.is_none_or(|m| ports >= m) && max.is_none_or(|m| ports <= m)
        })
        && c.not.as_ref().is_none_or(|n| !holds(n, node, links))
}

/// 診断の文に、要素の名前（`{name}`）と種類（`{kind}`）を差し込む。差し込んだ値の中はもう一度置き換えない。
///
/// # 引数
///
/// - `template`：ルールの `message`
/// - `node`：要素
///
/// # 戻り値
///
/// 差し込んだ文。ほかの `{…}` はそのまま残す。
///
/// # 例
///
/// ```text
/// fill_message("{kind}「{name}」", part def A)  → "part def「A」"
/// fill_message("{name}{name}", A)              → "AA"
/// fill_message("{other}", A)                   → "{other}"
/// fill_message("{name}", 名前が "{kind}" の要素) → "{kind}"   // 差し込んだ値は置き換えない
/// ```
pub(super) fn fill_message(template: &str, node: &Node) -> String {
    let mut out = String::new();
    let mut rest = template;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        if let Some(after) = tail.strip_prefix("{name}") {
            out.push_str(&node.name);
            rest = after;
        } else if let Some(after) = tail.strip_prefix("{kind}") {
            out.push_str(&node.kind);
            rest = after;
        } else {
            out.push('{');
            rest = &tail[1..];
        }
    }
    out.push_str(rest);
    out
}
