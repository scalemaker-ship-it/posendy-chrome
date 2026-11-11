#!/usr/bin/env bash
# posendy.com 에서 내려받는 설치 파일 2개를 만든다.
#   1) posendy-chrome-bridge.tgz  : 브리지 dist + npm 에 없는 posendy-chrome-shared(vendor/)
#                                   의존성은 설치 스크립트가 사용자 컴퓨터에서 npm install 로 받는다.
#   2) posendy-chrome-extension.zip : 확장 빌드(chrome-mv3/)
#
# 사용법: scripts/pack-posendy-downloads.sh [출력 폴더]
#   기본 출력 폴더 = _posendy/posendy-web/public/downloads
# 빌드는 먼저 해 둔다: pnpm build:shared && pnpm build:native && pnpm build:extension

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/_posendy/posendy-web/public/downloads}"
mkdir -p "$OUT"

NATIVE="$ROOT/app/native-server"
SHARED="$ROOT/packages/shared"
EXT="$ROOT/app/chrome-extension/.output/chrome-mv3"

for f in "$NATIVE/dist/cli.js" "$SHARED/dist/index.js" "$EXT/manifest.json"; do
  [ -f "$f" ] || { echo "빌드 결과가 없습니다: $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PKG="$WORK/posendy-chrome-bridge"
mkdir -p "$PKG/vendor/posendy-chrome-shared"

rsync -a --exclude node_path.txt --exclude '*.map' "$NATIVE/dist/" "$PKG/dist/"
cp "$NATIVE/README.md" "$PKG/" 2>/dev/null || true
rsync -a --exclude '*.map' "$SHARED/dist/" "$PKG/vendor/posendy-chrome-shared/dist/"

# shared package.json: 런타임에 필요한 필드만 남긴다.
node -e '
  const fs = require("fs");
  const [src, dst] = process.argv.slice(1);
  const p = JSON.parse(fs.readFileSync(src, "utf8"));
  const keep = ["name", "version", "main", "module", "types", "exports", "dependencies"];
  const out = {};
  for (const k of keep) if (p[k] !== undefined) out[k] = p[k];
  fs.writeFileSync(dst, JSON.stringify(out, null, 2) + "\n");
' "$SHARED/package.json" "$PKG/vendor/posendy-chrome-shared/package.json"

# bridge package.json: workspace 의존성을 vendor 경로로, 개발용 필드와 postinstall 제거
# (등록은 설치 스크립트가 명시적으로 한다).
node -e '
  const fs = require("fs");
  const [src, dst] = process.argv.slice(1);
  const p = JSON.parse(fs.readFileSync(src, "utf8"));
  p.dependencies["posendy-chrome-shared"] = "file:./vendor/posendy-chrome-shared";
  delete p.devDependencies;
  delete p.scripts;
  delete p.files;
  fs.writeFileSync(dst, JSON.stringify(p, null, 2) + "\n");
' "$NATIVE/package.json" "$PKG/package.json"

tar -C "$WORK" -czf "$OUT/posendy-chrome-bridge.tgz" posendy-chrome-bridge

rm -f "$OUT/posendy-chrome-extension.zip"
(cd "$(dirname "$EXT")" && zip -qr "$OUT/posendy-chrome-extension.zip" chrome-mv3 -x '*.map')

VERSION="$(node -p "require('$NATIVE/package.json').version")"
EXT_ID="$(node -e '
  const k = require(process.argv[1]).key;
  const h = require("crypto").createHash("sha256").update(Buffer.from(k, "base64")).digest("hex").slice(0, 32);
  console.log([...h].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""));
' "$EXT/manifest.json")"

echo "완료 (v$VERSION, 확장 ID $EXT_ID)"
ls -la "$OUT/posendy-chrome-bridge.tgz" "$OUT/posendy-chrome-extension.zip"
