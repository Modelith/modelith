//! つないだモデル（ADR-0021）から、表示中のファイルの要素と、それが参照するほかのファイルの要素だけを残す。
//!
//! 残すのは、表示中のファイルに書いた要素・関係・図・メモ・問題と、表示中のファイルに書いた関係の相手と
//! 表示中のファイルの view が示すほかのファイルの要素。`import` で取り込んだだけの要素は残さない。
//! ほかのファイルが無ければ、何も変えない。

use std::collections::HashSet;

use super::Model;
use crate::project::Entry;
use crate::project::merge::file_of;

/// 表示中のファイルの要素と、それが参照するほかのファイルの要素だけを残す。
///
/// # 引数
///
/// - `m`：つないだ解析結果から作ったモデル
/// - `entries`：つないだ解析結果の宣言
///
/// # 戻り値
///
/// 絞ったモデル。
///
/// # 例
///
/// ```text
/// // 表示中 "package A { part c : Car; import B::*; }"、ほか "package B { part def Car; part def Bus; }" のとき
/// keep_focus(m, entries).nodes のキー → ["c", "Car"]   // Bus は参照していないので残さない
/// ```
pub(super) fn keep_focus(mut m: Model, entries: &[Entry]) -> Model {
    let here = |entry: usize| entries.get(entry).is_some_and(|e| file_of(e.start) == 0);
    if entries.iter().all(|e| file_of(e.start) == 0) {
        return m;
    }
    m.edges.retain(|e| file_of(e.src.start) == 0);
    m.views.retain(|v| here(v.entry));
    m.notes.retain(|n| here(n.entry));
    m.action_flows.retain(|f| here(f.entry));
    m.state_machines.retain(|s| here(s.entry));
    m.sequences.retain(|s| here(s.entry));
    m.problems.retain(|p| file_of(p.pos) == 0);
    let referenced: HashSet<String> = m
        .edges
        .iter()
        .flat_map(|e| [e.from.clone(), e.to.clone()])
        .chain(m.views.iter().flat_map(|v| v.node_keys.iter().cloned()))
        .chain(m.notes.iter().flat_map(|n| n.targets.iter().cloned()))
        .collect();
    m.nodes
        .retain(|n| n.file.is_none() || referenced.contains(&n.key));
    let kept: HashSet<&str> = m.nodes.iter().map(|n| n.key.as_str()).collect();
    for v in &mut m.views {
        v.frames.retain(|f| here(f.entry));
        for f in &mut v.frames {
            f.node_keys.retain(|k| kept.contains(k.as_str()));
        }
    }
    m
}
