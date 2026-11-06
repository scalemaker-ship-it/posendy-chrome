#!/usr/bin/env python3
"""auto-chrome-mcp → POSENDY 브라우저 연결 리브랜딩 (재실행 가능). 확장 키/ID는 그대로 둔다(설치된 확장을 제자리 교체하기 위해)."""
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
skip = {'node_modules', '.git', 'dist', '.output', 'releases', '.wxt'}
pairs = [('mcp-chrome-scalemaker-bridge', 'posendy-chrome-bridge'), ('chrome-mcp-scalemaker-shared', 'posendy-chrome-shared'), ('auto-chrome-mcp-extension', 'posendy-chrome-extension'), ('auto-chrome-mcp-bridge', 'posendy-chrome-bridge'), ('com.chromemcpscalemaker.nativehost', 'com.posendy.nativehost'), ('com.autochromemcp.nativehost', 'com.posendy.nativehost'), ('12321', '12330'), ('12320', '12330'), ('Auto Chrome MCP', 'POSENDY Chrome'), ('scalemaker-install', 'posendy-install'), ('mcp-chrome-scalemaker', 'posendy-chrome'), ('chrome-mcp-scalemaker', 'posendy-chrome'), ('auto-chrome-mcp', 'posendy-chrome')]
n = 0
for p in root.rglob('*'):
    if any(s in p.parts for s in skip) or not p.is_file() or p.name == 'rebrand-posendy.py': continue
    if p.suffix in {'.png', '.jpg', '.wasm', '.woff', '.woff2', '.ico', '.gif', '.pem', '.zip'} or p.name == 'pnpm-lock.yaml': continue
    try: s = p.read_text('utf-8')
    except Exception: continue
    o = s
    for a, b in pairs: s = s.replace(a, b)
    if s != o: p.write_text(s, 'utf-8'); n += 1
for loc, name, desc in [('ko', 'POSENDY 브라우저 연결', '포샌디 브라우저 연결 확장이에요. 네이버 블로그 발행을 내 크롬에서 처리하고, AI 앱이 내 크롬을 MCP로 쓸 수 있게 해요.'), ('en', 'POSENDY Browser Bridge', 'POSENDY browser bridge: publishes Naver Blog posts from your own Chrome and exposes Chrome to AI apps over MCP.'), ('ja', 'POSENDY Browser Bridge', None), ('de', 'POSENDY Browser Bridge', None)]:
    p = root / f'app/chrome-extension/_locales/{loc}/messages.json'
    if not p.exists(): continue
    d = json.loads(p.read_text()); d['extensionName']['message'] = name
    if desc: d['extensionDescription']['message'] = desc
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2))
p = root / 'app/chrome-extension/entrypoints/popup/App.vue'; s = p.read_text()
s = re.sub(r'<h1 class="header-title">[^<]*</h1>', '<h1 class="header-title">POSENDY 브라우저 연결</h1>', s, count=1); p.write_text(s)
p = root / 'app/chrome-extension/wxt.config.ts'; s = p.read_text()
s = s.replace("default_title: 'POSENDY Chrome'", "default_title: 'POSENDY 브라우저 연결'"); p.write_text(s)
print('rebrand: files changed', n)
