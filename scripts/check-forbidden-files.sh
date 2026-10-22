#!/usr/bin/env bash
# Git 管理下に置いてはいけないファイル（scripts/harness.conf の HARNESS_FORBIDDEN_PATHS）が無いか検証する。
set -euo pipefail
# shellcheck source=lib/load.sh
source "$(dirname "$0")/lib/load.sh"
harness_load

if found="$(git -C "$HARNESS_ROOT" ls-files | policy_forbidden_paths)"; then
  echo "forbidden files: none"
else
  echo "ERROR: コミットしてはいけないファイルが Git 管理下にあります:" >&2
  head -20 <<<"$found" >&2
  exit 1
fi
