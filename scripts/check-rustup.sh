#!/usr/bin/env bash
# rustup 自身が下限の版以上か検証する。古い rustup はツールチェーンを取るときの TLS の確かめが甘い（RUSTSEC-2026-0382）。
# CI で 'rustup self update' の後、ツールチェーンを入れる前に実行する。
#   scripts/check-rustup.sh
set -euo pipefail
# shellcheck source=lib/load.sh
source "$(dirname "$0")/lib/load.sh"
harness_load

line="$(rustup --version 2>/dev/null | head -n 1)" || line=""
if reason="$(policy_rustup_version "$line")"; then
  echo "rustup OK: $line"
else
  echo "ERROR: $reason" >&2
  exit 1
fi
