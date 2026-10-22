#!/usr/bin/env bash
# PR タイトル（= Squash 後のコミットメッセージ）が Conventional Commits 形式か検証する。
#   scripts/check-pr-title.sh "<title>"
set -euo pipefail
# shellcheck source=lib/load.sh
source "$(dirname "$0")/lib/load.sh"
harness_load

title="${1:?usage: $0 <title>}"
if reason="$(policy_pr_title "$title")"; then
  echo "title OK: $title"
else
  echo "ERROR: $reason" >&2
  exit 1
fi
