# shellcheck shell=bash
# フック用の入出力アダプタ。Claude Code のフック規約（標準入力の JSON・終了コード・JSON 出力）を
# この 1 か所に閉じ込め、フック本体は「入力を取り出す → policy_* で判断 → 結果を返す」だけにする。

# 標準入力の JSON を一度だけ読み、以降は hook_field で取り出す。
hook_read_input() {
  HOOK_INPUT="$(cat)"
}

# jq のパスで値を取り出す（無ければ空文字）。
hook_field() {
  jq -r "$1 // \"\"" <<<"$HOOK_INPUT"
}

# ツール実行をブロックする（終了コード 2、理由は stderr がエージェントへのフィードバックになる）。
hook_block() {
  echo "BLOCKED: $1" >&2
  echo "参照: ${HARNESS_STRATEGY_DOC:-CLAUDE.md}" >&2
  exit 2
}

# PreToolUse の許可判定を JSON で返す（decision: allow | ask | deny）。
hook_decide() {
  jq -n --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $d, permissionDecisionReason: $r}}'
  exit 0
}
