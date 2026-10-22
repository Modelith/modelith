#!/usr/bin/env bash
# PR の向け先とマージ元の組み合わせがブランチ戦略に沿っているか検証する（ADR-0007）。
#   scripts/check-pr-base.sh <base> <head>
set -euo pipefail
# shellcheck source=lib/load.sh
source "$(dirname "$0")/lib/load.sh"
harness_load

base="${1:?usage: $0 <base> <head>}"
head="${2:?usage: $0 <base> <head>}"
if reason="$(policy_pr_base "$base" "$head")"; then
  echo "PR base OK: $head → $base"
else
  echo "ERROR: $reason" >&2
  exit 1
fi
