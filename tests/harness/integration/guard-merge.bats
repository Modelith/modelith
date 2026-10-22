#!/usr/bin/env bats
# .claude/hooks/guard-merge.sh の結合テスト。GitHub API の代わりに file:// の JSON を返す（HARNESS_GITHUB_API で注入）。

setup() {
  load ../helpers
  make_sandbox
  HOOK="$SANDBOX/.claude/hooks/guard-merge.sh"
  export HARNESS_GITHUB_API="file://$BATS_TEST_TMPDIR/api"
}

# API の応答を用意する: fake_pr <number> <base> <head>
fake_pr() {
  mkdir -p "$BATS_TEST_TMPDIR/api/repos/o/r/pulls"
  jq -nc --arg b "$2" --arg h "$3" '{base:{ref:$b},head:{ref:$h}}' >"$BATS_TEST_TMPDIR/api/repos/o/r/pulls/$1"
}

decision_of() { # tool input_fields
  "$HOOK" <<<"$(hook_input "{tool_name:\"$1\",tool_input:({owner:\"o\",repo:\"r\"} + $2)}")" |
    jq -r .hookSpecificOutput.permissionDecision
}

@test "guard-merge: トピック → dev の squash は許可する（正常系）" {
  # Arrange
  fake_pr 1 dev feat/x
  # Act
  run decision_of mcp__github__merge_pull_request '{pullNumber:1,merge_method:"squash"}'
  # Assert
  [ "$output" = allow ]
}

@test "guard-merge: auto-merge の大文字の方式名も判定できる（正常系）" {
  # Arrange
  fake_pr 2 main dev
  # Act
  run decision_of mcp__github__enable_pr_auto_merge '{pullNumber:2,mergeMethod:"MERGE"}'
  # Assert
  [ "$output" = ask ]
}

@test "guard-merge: dev → main を squash しようとしたら拒否する（異常系）" {
  # Arrange
  fake_pr 3 main dev
  # Act
  run decision_of mcp__github__merge_pull_request '{pullNumber:3,merge_method:"squash"}'
  # Assert
  [ "$output" = deny ]
}

@test "guard-merge: 方式を省略したら拒否する（境界値: 方式なし）" {
  # Arrange
  fake_pr 4 dev feat/x
  # Act
  run decision_of mcp__github__merge_pull_request '{pullNumber:4}'
  # Assert
  [ "$output" = deny ]
}

@test "guard-merge: PR を取得できなければ承認を求める（異常系: API 失敗）" {
  # Arrange
  local missing_pr=999
  # Act
  run decision_of mcp__github__merge_pull_request "{pullNumber:$missing_pr,merge_method:\"squash\"}"
  # Assert
  [ "$output" = ask ]
}
