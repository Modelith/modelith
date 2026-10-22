# shellcheck shell=bash
# ハーネスの判断ロジック（純粋関数）。I/O（標準入力の JSON・git・ネットワーク）を一切持たない。
# 呼び出し側（フック・check-*.sh）が入力を集めて渡し、結果だけを受け取る。
#
# 規約:
#   - 検査関数は「問題なし」で 0、「違反」で 1 を返し、違反時は理由を標準出力に 1 行で出す。
#   - リポジトリ固有の値は scripts/harness.conf の HARNESS_* 変数から受け取る（このファイルは共有）。

POLICY_COMMIT_TYPES='feat|fix|refactor|perf|test|docs|build|ci|chore|revert'

# PR タイトル（= Squash 後のコミットメッセージ）が Conventional Commits 形式か。
policy_pr_title() {
  local title=$1
  [[ $title =~ ^(${POLICY_COMMIT_TYPES})(\([a-z0-9._-]+\))?!?:\ .+$ ]] && return 0
  echo "PR タイトル '$title' は Conventional Commits 形式ではありません（例: feat(parser): add KerML lexer）。"
  return 1
}

# PR の向け先とマージ元の組み合わせが許されるか。main へは dev（リリース）と fix/*（緊急修正）のみ。
policy_pr_base() {
  local base=$1 head=$2
  [[ $base != main || $head == dev || $head == fix/* ]] && return 0
  echo "$head → main の PR は認められていません。通常の作業は dev に向けてください。"
  return 1
}

# PR のマージ操作の判定。標準出力に "<allow|ask|deny><TAB><理由>" を出す（常に 0 を返す）。
policy_merge_decision() {
  local base=$1 head=$2 method=$3
  case "$base:$head:$method" in
    dev:main:merge) printf 'allow\tmain → dev の同期（マージコミット）\n' ;;
    dev:main:*) printf 'deny\tmain → dev の同期はマージコミット（merge）のみです。\n' ;;
    dev:*:squash) printf 'allow\tトピック → dev の Squash merge\n' ;;
    dev:*:*) printf 'deny\tdev へのマージは Squash（squash）のみです。\n' ;;
    main:*:merge) printf 'ask\tmain へのマージにはメンテナの明示的な許可が必要です（PR ごと）。\n' ;;
    main:*:*) printf 'deny\tmain へのマージはマージコミット（merge）のみです。\n' ;;
    :*) printf 'ask\tPR のマージ先を確認できませんでした。メンテナの許可を得てください。\n' ;;
    *) printf 'ask\t想定外のマージ先 %s です。メンテナの許可を得てください。\n' "$base" ;;
  esac
}

# git push の違反（保護ブランチへの push、保護ブランチ上での push、--force）。
policy_git_push() {
  local cmd=$1 branch=$2
  [[ $cmd =~ git[[:space:]]+push ]] || return 0
  if [[ $cmd =~ (^|[[:space:]:])(refs/heads/)?(${HARNESS_PROTECTED_BRANCHES})([[:space:]]|$) ]]; then
    echo "保護ブランチ（${HARNESS_PROTECTED_BRANCHES//|/ \/ }）への直接 push は禁止です。トピックブランチから PR を作成してください。"
    return 1
  fi
  if [[ $branch =~ ^(${HARNESS_PROTECTED_BRANCHES})$ && ! $cmd =~ [[:space:]][a-z]+/ ]]; then
    echo "$branch ブランチ上での push は禁止です。"
    return 1
  fi
  if [[ $cmd =~ (--force([[:space:]]|$)|[[:space:]]-f([[:space:]]|$)) ]]; then
    echo "--force は禁止です。必要なら自分のブランチに限り --force-with-lease を使ってください。"
    return 1
  fi
}

# 保護ブランチ上で履歴を変える操作の違反。
policy_git_on_protected() {
  local cmd=$1 branch=$2
  [[ $branch =~ ^(${HARNESS_PROTECTED_BRANCHES})$ && $cmd =~ git[[:space:]]+(commit|merge|rebase|reset) ]] || return 0
  echo "$branch 上での commit/merge/rebase/reset は禁止です。先に 'git switch -c <type>/<topic>' してください。"
  return 1
}

# 一括ステージ（git add -A / --all / . / :/）の違反。
policy_git_bulk_add() {
  local cmd=$1
  local re='git[[:space:]]+add[[:space:]]+([^;&|]*[[:space:]])?(-A|--all|\.|:/)([[:space:];&|]|$)'
  [[ $cmd =~ $re ]] || return 0
  echo "git add -A / --all / . は禁止です。追加するファイルやディレクトリを明示してください。"
  return 1
}

# git コマンド全体の検査。最初に見つかった違反を報告する。
policy_git_command() {
  local cmd=$1 branch=$2
  policy_git_push "$cmd" "$branch" && policy_git_on_protected "$cmd" "$branch" && policy_git_bulk_add "$cmd"
}

# 標準入力のパス一覧のうち、Git 管理下に置いてはいけないものを出力する。
policy_forbidden_paths() {
  local found
  found=$(grep -E "$HARNESS_FORBIDDEN_PATHS" || true)
  [[ -z $found ]] && return 0
  echo "$found"
  return 1
}

# 標準入力の変更パス一覧に、停止前の検証が必要な変更が含まれるか（含まれれば 0）。
policy_needs_verify() {
  grep -qE "$HARNESS_VERIFY_TRIGGER"
}

# rustup の版の下限。これより古い rustup は、ツールチェーンを取るときの TLS の確かめが甘い（RUSTSEC-2026-0382）。
POLICY_RUSTUP_MIN_VERSION='1.29.2'

# rustup の版が下限（POLICY_RUSTUP_MIN_VERSION）以上か。`rustup --version` の 1 行目を受け取る。
# 例: "rustup 1.29.2 (d8c92c676 2026-10-21)" → 0、"rustup 1.28.2 (...)" → 1（理由を出す）、"" → 1（読み取れない）。
policy_rustup_version() {
  local line=$1 re='^rustup[[:space:]]+([0-9]+)\.([0-9]+)\.([0-9]+)'
  if [[ ! $line =~ $re ]]; then
    echo "rustup の版を読み取れませんでした（'$line'）。"
    return 1
  fi
  local -a have=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}") need
  IFS=. read -ra need <<<"$POLICY_RUSTUP_MIN_VERSION"
  local i
  for i in 0 1 2; do
    ((10#${have[i]} > 10#${need[i]})) && return 0
    ((10#${have[i]} < 10#${need[i]})) && break
    ((i == 2)) && return 0
  done
  echo "rustup ${have[0]}.${have[1]}.${have[2]} は古すぎます（${POLICY_RUSTUP_MIN_VERSION} 以上が必要。RUSTSEC-2026-0382）。'rustup self update' で更新してください。"
  return 1
}
