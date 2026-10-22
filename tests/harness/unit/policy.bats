#!/usr/bin/env bats
# scripts/lib/policy.sh の単体テスト。I/O を持たない判断関数を、同値分割・境界値で検証する。

setup() {
  load ../helpers
  load_policy
}

# --- policy_pr_title ---

@test "policy_pr_title: scope あり・なし・破壊的変更の ! を許可する（正常系）" {
  # Arrange
  local titles=("feat(parser): add lexer" "fix: crash" "feat(core)!: change API")
  # Act
  local results=() t
  for t in "${titles[@]}"; do results+=("$(status_of policy_pr_title "$t")"); done
  # Assert
  [ "${results[*]}" = "0 0 0" ]
}

@test "policy_pr_title: 型なし・コロン後の空白なし・要約なしは拒否する（異常系・境界値）" {
  # Arrange
  local titles=("Add stuff" "feat:no space" "feat: " "feat(Parser): x")
  # Act
  local results=() t
  for t in "${titles[@]}"; do results+=("$(status_of policy_pr_title "$t")"); done
  # Assert
  [ "${results[*]}" = "1 1 1 1" ]
}

# --- policy_pr_base ---

@test "policy_pr_base: dev 向けは何でも、main 向けは dev と fix/* だけ許可する（正常系）" {
  # Arrange
  local pairs=("dev feat/x" "dev main" "main dev" "main fix/y" "docs/a chore/b")
  # Act
  local results=() p
  for p in "${pairs[@]}"; do read -r base head <<<"$p"; results+=("$(status_of policy_pr_base "$base" "$head")"); done
  # Assert
  [ "${results[*]}" = "0 0 0 0 0" ]
}

@test "policy_pr_base: トピックブランチから main への PR は拒否する（異常系）" {
  # Arrange
  local base=main head=feat/x
  # Act
  run policy_pr_base "$base" "$head"
  # Assert
  [ "$status" -eq 1 ]
  [[ $output == *"dev に向けて"* ]]
}

# --- policy_merge_decision ---

@test "policy_merge_decision: マージ先・マージ元・方式の組み合わせごとの判定（同値分割）" {
  # Arrange
  local cases=(
    "dev feat/x squash:allow" "dev feat/x merge:deny" "dev feat/x :deny"
    "dev main merge:allow" "dev main squash:deny"
    "main dev merge:ask" "main fix/y merge:ask" "main dev squash:deny"
    " feat/x squash:ask" "foo feat/x squash:ask"
  )
  # Act
  local got=() c base head method
  for c in "${cases[@]}"; do
    read -r base head method <<<"${c%%:*}"
    [[ ${c:0:1} == " " ]] && { method=$head; head=$base; base=""; }
    got+=("$(policy_merge_decision "$base" "$head" "$method" | cut -f1)")
  done
  # Assert
  [ "${got[*]}" = "allow deny deny allow deny ask ask deny ask ask" ]
}

# --- policy_git_command ---

@test "policy_git_command: トピックブランチでの通常操作は許可する（正常系）" {
  # Arrange
  local cmds=("git push -u origin feat/x" "git push --force-with-lease origin feat/x" "git add src/a.rs" "git commit -m x" "ls")
  # Act
  local results=() c
  for c in "${cmds[@]}"; do results+=("$(status_of policy_git_command "$c" feat/x)"); done
  # Assert
  [ "${results[*]}" = "0 0 0 0 0" ]
}

@test "policy_git_command: 保護ブランチへの push と --force は拒否する（異常系）" {
  # Arrange
  local cmds=("git push origin main" "git push origin HEAD:dev" "git push --force origin feat/x" "git push -f origin feat/x")
  # Act
  local results=() c
  for c in "${cmds[@]}"; do results+=("$(status_of policy_git_command "$c" feat/x)"); done
  # Assert
  [ "${results[*]}" = "1 1 1 1" ]
}

@test "policy_git_command: 保護ブランチ上の commit と、引数なし push は拒否する（異常系）" {
  # Arrange
  local branch=dev
  # Act
  local commit push
  commit=$(status_of policy_git_command "git commit -m x" "$branch")
  push=$(status_of policy_git_command "git push" "$branch")
  # Assert
  [ "$commit $push" = "1 1" ]
}

@test "policy_git_command: 一括ステージは拒否し、ドットで始まるパスは許可する（異常系・境界値）" {
  # Arrange
  local cmds=("git add -A" "git add --all" "git add ." "cd x && git add . && git status" "git add .gitignore" "git add ./src")
  # Act
  local results=() c
  for c in "${cmds[@]}"; do results+=("$(status_of policy_git_command "$c" feat/x)"); done
  # Assert
  [ "${results[*]}" = "1 1 1 1 0 0" ]
}

# --- policy_forbidden_paths / policy_needs_verify ---

@test "policy_forbidden_paths: 禁止パスだけを出力して 1 を返す（異常系）" {
  # Arrange
  local paths=$'src/a.rs\nweb/node_modules/x.js\nsecret/plan.html'
  # Act
  run policy_forbidden_paths <<<"$paths"
  # Assert
  [ "$status" -eq 1 ]
  [ "$output" = $'web/node_modules/x.js\nsecret/plan.html' ]
}

@test "policy_forbidden_paths: 禁止パスが無い・空入力なら 0 を返す（正常系・境界値）" {
  # Arrange
  local paths=$'src/a.rs\nsecretary.md'
  # Act
  local normal empty
  normal=$(status_of_stdin "$paths" policy_forbidden_paths)
  empty=$(status_of_stdin "" policy_forbidden_paths)
  # Assert
  [ "$normal $empty" = "0 0" ]
}

@test "policy_needs_verify: 対象の変更があるときだけ 0 を返す（正常系・異常系）" {
  # Arrange
  local relevant=$'README.md\nsrc/lib.rs' irrelevant=$'README.md\ndocs/a.md'
  # Act
  local r i
  r=$(status_of_stdin "$relevant" policy_needs_verify)
  i=$(status_of_stdin "$irrelevant" policy_needs_verify)
  # Assert
  [ "$r $i" = "0 1" ]
}

# --- policy_rustup_version ---

@test "policy_rustup_version: 下限ちょうど・それより新しい版を許可する（正常系・境界値）" {
  # Arrange
  local equal="rustup 1.29.2 (d8c92c676 2026-10-21)" patch="rustup 1.29.3 (x 2026-11-01)"
  local minor="rustup 1.30.0 (x 2027-01-01)" major="rustup 2.0.0 (x 2028-01-01)"
  # Act
  local e p mi ma
  e=$(status_of policy_rustup_version "$equal")
  p=$(status_of policy_rustup_version "$patch")
  mi=$(status_of policy_rustup_version "$minor")
  ma=$(status_of policy_rustup_version "$major")
  # Assert
  [ "$e $p $mi $ma" = "0 0 0 0" ]
}

@test "policy_rustup_version: 下限より古い版は理由を出して 1 を返す（異常系・境界値）" {
  # Arrange
  local below="rustup 1.29.1 (x 2026-09-01)" older_minor="rustup 1.28.9 (x 2026-01-01)" older_major="rustup 0.99.99"
  # Act
  local b om oj
  b=$(status_of policy_rustup_version "$below")
  om=$(status_of policy_rustup_version "$older_minor")
  oj=$(status_of policy_rustup_version "$older_major")
  run policy_rustup_version "$below"
  # Assert
  [ "$b $om $oj" = "1 1 1" ]
  [[ $output == "rustup 1.29.1 は古すぎます"* ]]
}

@test "policy_rustup_version: 版を読み取れない入力は 1 を返す（異常系: 空・別のコマンドの出力）" {
  # Arrange
  local empty="" other="rustc 1.99.1 (58cf8f9c3 2026-10-13)"
  # Act
  local e o
  e=$(status_of policy_rustup_version "$empty")
  o=$(status_of policy_rustup_version "$other")
  run policy_rustup_version "$other"
  # Assert
  [ "$e $o" = "1 1" ]
  [[ $output == "rustup の版を読み取れませんでした"* ]]
}
