#!/usr/bin/env bash
# 크롬 웹스토어 업로드용 zip 을 만든다: store/posendy-chrome-store-v<버전>.zip
# 웹스토어는 확장 ID 를 스스로 정하므로 manifest 의 key 필드를 뺀다(사이드로드 빌드는 key 유지).
# 먼저 빌드: pnpm build:shared && pnpm build:extension
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/app/chrome-extension/.output/chrome-mv3"
[ -f "$EXT/manifest.json" ] || { echo "확장 빌드가 없습니다: $EXT" >&2; exit 1; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
rsync -a --exclude '*.map' "$EXT/" "$WORK/ext/"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const m = JSON.parse(fs.readFileSync(f, "utf8")); delete m.key;
  fs.writeFileSync(f, JSON.stringify(m, null, 2));
' "$WORK/ext/manifest.json"
VERSION="$(node -p "require('$WORK/ext/manifest.json').version")"
OUT="$ROOT/store/posendy-chrome-store-v$VERSION.zip"
rm -f "$OUT"; (cd "$WORK/ext" && zip -qr "$OUT" .)
echo "완료: $OUT ($(du -h "$OUT" | cut -f1))"
