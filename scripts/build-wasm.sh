#!/usr/bin/env bash
# Rust のコアを wasm にし、web から読める形（web/src/core/wasm/）に書き出す（ADR-0015）。
# check.sh（web のテストの前）と公開のワークフローが使う。
#   scripts/build-wasm.sh
#
# wasm-bindgen の CLI は、Cargo.lock の wasm-bindgen クレートと同じ版でなければならない。
# 手元に無ければ、公式の配布物を target/tools/ に取ってきて、ハッシュを確かめてから使う。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# 配布物（x86_64 Linux）のハッシュ。wasm-bindgen を上げたら、ここも更新する
WASM_BINDGEN_VERSION_PINNED=0.2.129
WASM_BINDGEN_SHA256=82d12bb940e2d4e72e0d5605387fc1b8ca179044e012b620f0ce4e7440e8320e

OUT_DIR=web/src/core/wasm

locked_version() {
  awk '/^name = "wasm-bindgen"$/ { getline; gsub(/version = |"/, ""); print; exit }' Cargo.lock
}

ensure_wasm_bindgen() {
  local version=$1
  if command -v wasm-bindgen >/dev/null && [[ $(wasm-bindgen --version) == "wasm-bindgen $version" ]]; then
    command -v wasm-bindgen
    return
  fi
  local dir="target/tools/wasm-bindgen-$version"
  if [[ ! -x $dir/wasm-bindgen ]]; then
    if [[ $version != "$WASM_BINDGEN_VERSION_PINNED" ]]; then
      echo "ERROR: Cargo.lock の wasm-bindgen は $version ですが、scripts/build-wasm.sh は $WASM_BINDGEN_VERSION_PINNED のハッシュしか知りません。版とハッシュを更新してください" >&2
      exit 1
    fi
    if [[ $(uname -sm) != "Linux x86_64" ]]; then
      echo "ERROR: wasm-bindgen $version が見つかりません。cargo install wasm-bindgen-cli --version $version で入れてください" >&2
      exit 1
    fi
    local name="wasm-bindgen-$version-x86_64-unknown-linux-musl"
    local archive="target/tools/$name.tar.gz"
    mkdir -p target/tools
    echo "wasm-bindgen $version を取得します" >&2
    curl -sSfL -o "$archive" "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/$name.tar.gz"
    echo "$WASM_BINDGEN_SHA256  $archive" | sha256sum --check --quiet
    # 前の途中までの展開が残っていても、作り直す
    rm -rf "$dir"
    mkdir -p "$dir"
    tar -xzf "$archive" -C "$dir" --strip-components=1
  fi
  echo "$dir/wasm-bindgen"
}

version=$(locked_version)
bindgen=$(ensure_wasm_bindgen "$version")
cargo build -p modelith-wasm --target wasm32-unknown-unknown --release --quiet
"$bindgen" target/wasm32-unknown-unknown/release/modelith_wasm.wasm --target web --out-dir "$OUT_DIR" --out-name modelith_core
