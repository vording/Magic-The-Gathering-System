#!/usr/bin/env bash
# phase.rs（https://github.com/phase-rs/phase、MIT / Apache-2.0）のルールエンジンを WASM にして vendor/phase/ に置く。
# 必要なもの：rustup（phase.rs の rust-toolchain.toml の nightly が自動で入る）、wasm32 ターゲット、node / npm
# 使い方: tools/phase/build.sh <phase.rs を clone したフォルダ>
set -euo pipefail
PHASE="${1:?phase.rs のフォルダを指定してください}"
APP="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. カードデータ：このアプリのカード一覧 → MTGJSON 形式 → phase.rs の card-data.json
python3 "$APP/tools/phase/to_mtgjson.py" "$WORK/data"
(cd "$PHASE" && cargo build --profile tool --features cli --bin oracle-gen --bin coverage-report)
"$PHASE/target/tool/oracle-gen" "$WORK/data" --output "$WORK/data/card-data.json" --stats
"$PHASE/target/tool/coverage-report" "$WORK/data" --all --brief > "$WORK/coverage.json" || true

# 2. エンジン：WASM（wasm-bindgen の版は phase.rs の Cargo.lock に合わせる）
BINDGEN_VERSION="$(grep -A1 'name = "wasm-bindgen"$' "$PHASE/Cargo.lock" | sed -n 's/version = "\(.*\)"/\1/p')"
cargo install wasm-bindgen-cli --version "$BINDGEN_VERSION" --locked
(cd "$PHASE" && cargo build --package engine-wasm --target wasm32-unknown-unknown --release)
wasm-bindgen --target web --out-dir "$WORK/wasm" --out-name engine_wasm "$PHASE/target/wasm32-unknown-unknown/release/engine_wasm.wasm"
npm --prefix "$WORK/tools" i binaryen --silent
"$WORK/tools/node_modules/.bin/wasm-opt" -Oz --strip-debug --enable-bulk-memory --enable-nontrapping-float-to-int \
  "$WORK/wasm/engine_wasm_bg.wasm" -o "$WORK/wasm/engine_opt.wasm"

# 3. 置く（大きいので gzip のまま置き、ブラウザで展開する）
OUT="$APP/vendor/phase"
mkdir -p "$OUT"
cp "$WORK/wasm/engine_wasm.js" "$OUT/engine_wasm.js"
gzip -9 -c "$WORK/wasm/engine_opt.wasm" > "$OUT/engine_wasm_bg.wasm.gz"
gzip -9 -c "$WORK/data/card-data.json" > "$OUT/card-data.json.gz"
cp "$PHASE/LICENSE-MIT" "$PHASE/LICENSE-APACHE" "$PHASE/NOTICE" "$OUT/"
echo "phase.rs $(git -C "$PHASE" rev-parse HEAD) ($(git -C "$PHASE" log -1 --format=%ci))" > "$OUT/VERSION"
# 対応していないカードの一覧（開始画面で警告に使う）
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
bad = {x['card_name']: [g.get('label') or g.get('handler') or str(g)[:80] for g in (x.get('gap_details') or [])][:3] for x in d['cards'] if not x['supported']}
json.dump({'supported': d['supported_cards'], 'total': d['total_cards'], 'unsupported': bad}, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
print('対応：', d['supported_cards'], '/', d['total_cards'])
" "$WORK/coverage.json" "$OUT/coverage.json"
