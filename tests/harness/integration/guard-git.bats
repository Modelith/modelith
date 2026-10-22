#!/usr/bin/env bats
# .claude/hooks/guard-git.sh の結合テスト（JSON 入力 → policy → 終了コード、実際の Git リポジトリ）。

setup() {
  bats_require_minimum_version 1.5.0
  load ../helpers
  make_sandbox
  HOOK="$SANDBOX/.claude/hooks/guard-git.sh"
}

run_hook() { # command
  run --separate-stderr "$HOOK" <<<"$(hook_input "{tool_input:{command:\"$1\"}}")"
}

@test "guard-git: git 以外のコマンドは素通しする（正常系）" {
  # Arrange
  local cmd="ls -la"
  # Act
  run_hook "$cmd"
  # Assert
  [ "$status" -eq 0 ]
}

@test "guard-git: トピックブランチからの push は許可する（正常系）" {
  # Arrange
  local cmd="git push -u origin feat/sandbox"
  # Act
  run_hook "$cmd"
  # Assert
  [ "$status" -eq 0 ]
}

@test "guard-git: dev への push は理由と参照先を付けてブロックする（異常系）" {
  # Arrange
  local cmd="git push origin dev"
  # Act
  run_hook "$cmd"
  # Assert
  [ "$status" -eq 2 ]
  [[ $stderr == *"直接 push は禁止"* && $stderr == *"docs/strategy.md"* ]]
}

@test "guard-git: 保護ブランチ上の commit は実際のブランチ名で判定する（異常系）" {
  # Arrange
  git -C "$SANDBOX" switch -q -c dev
  # Act
  run_hook "git commit -m x"
  # Assert
  [ "$status" -eq 2 ]
  [[ $stderr == *"dev 上での commit"* ]]
}

@test "guard-git: 禁止パスがステージされていれば commit をブロックする（異常系）" {
  # Arrange
  mkdir -p "$SANDBOX/secret" && echo x >"$SANDBOX/secret/plan.html"
  git -C "$SANDBOX" add secret/plan.html
  # Act
  run_hook "git commit -m x"
  # Assert
  [ "$status" -eq 2 ]
  [[ $stderr == *"secret/plan.html"* ]]
}

@test "guard-git: 許可されたファイルだけがステージされていれば commit を許可する（正常系）" {
  # Arrange
  echo x >"$SANDBOX/a.txt"
  git -C "$SANDBOX" add a.txt
  # Act
  run_hook "git commit -m x"
  # Assert
  [ "$status" -eq 0 ]
}
