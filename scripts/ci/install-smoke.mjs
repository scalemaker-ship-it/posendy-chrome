#!/usr/bin/env node
// 설치 직후 스모크 테스트. 크롬이 네이티브 호스트를 띄우는 경로를 그대로 따라간다.
//   1. 네이티브 메시징 manifest 찾기 (Windows: HKCU 레지스트리, macOS/Linux: 고정 경로)
//   2. manifest 의 path(run_host.bat / run_host.sh) 존재, allowed_origins 에 확장 ID 포함 확인
//   3. 크롬처럼 호스트를 실행하고 네이티브 메시지 {type:'start'} 를 보내 'server_started' 응답 확인
//   4. stdio MCP 서버를 띄워 initialize + tools/list 로 도구 목록 확인
// 사용: node scripts/ci/install-smoke.mjs [port]   (기본 12399, 실사용 12330 과 겹치지 않게)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST_NAME = 'com.posendy.nativehost';
const EXT_IDS = ['dafdlgggdlfgiojdcjlaclelodbfajpp', 'hjahjpbpflhcpdgafpnmapgjnkgclnci'];
const PORT = Number(process.argv[2] || 12399);
const isWin = process.platform === 'win32';

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`OK  : ${msg}`);
}

// ---------- 1. manifest ----------
function findManifest() {
  if (isWin) {
    const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    let out;
    try {
      out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8' });
    } catch {
      fail(`레지스트리 키 없음: ${key}`);
    }
    const m = out.match(/REG_SZ\s+(.+)/);
    if (!m) fail(`레지스트리 값 파싱 실패:\n${out}`);
    ok(`레지스트리 ${key}`);
    return m[1].trim();
  }
  const dir =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
      : path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts');
  return path.join(dir, `${HOST_NAME}.json`);
}

const manifestPath = findManifest();
if (!fs.existsSync(manifestPath)) fail(`manifest 파일 없음: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
ok(`manifest ${manifestPath}`);
if (manifest.name !== HOST_NAME) fail(`manifest.name=${manifest.name}`);
if (!fs.existsSync(manifest.path)) fail(`호스트 실행 파일 없음: ${manifest.path}`);
ok(`호스트 실행 파일 ${manifest.path}`);
for (const id of EXT_IDS) {
  if (!manifest.allowed_origins?.includes(`chrome-extension://${id}/`))
    fail(`allowed_origins 에 ${id} 없음: ${JSON.stringify(manifest.allowed_origins)}`);
}
ok(`allowed_origins 에 확장 ID ${EXT_IDS.length}개 포함`);

// ---------- 2. 네이티브 호스트 start ----------
function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
}

async function startNativeHost() {
  const origin = `chrome-extension://${EXT_IDS[0]}/`;
  // 크롬은 Windows 에서 cmd /d /s /c "<path>" <origin> 형태로 호스트를 띄운다
  const child = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', `"${manifest.path}" ${origin}`], {
        windowsVerbatimArguments: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    : spawn(manifest.path, [origin], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0);
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`30초 안에 응답 없음. stderr:\n${stderr.slice(-2000)}`)),
      30000,
    );
    child.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) break;
        const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
        buf = buf.subarray(4 + len);
        if (msg.type === 'server_started' || msg.type === 'error' || msg.type === 'port_conflict') {
          clearTimeout(timer);
          resolve(msg);
          return;
        }
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`호스트가 먼저 종료됨 (code ${code}). stderr:\n${stderr.slice(-2000)}`));
    });
    child.stdin.write(encode({ type: 'start', payload: { port: PORT } }));
  });
  return { child, reply };
}

const { child: host, reply } = await startNativeHost().catch((e) => fail(e.message));
if (reply.type !== 'server_started') fail(`start 응답: ${JSON.stringify(reply)}`);
ok(`네이티브 호스트 server_started (port ${reply.payload?.port})`);

// ---------- 3. stdio MCP tools/list ----------
// POSENDY_STDIO 를 주면 그 경로(posendy.com 설치본: ~/.posendy-chrome/bridge)를, 아니면 npm 전역 설치본을 쓴다
let stdioJs = process.env.POSENDY_STDIO;
if (!stdioJs) {
  const npmRoot = execFileSync(isWin ? 'npm.cmd' : 'npm', ['root', '-g'], {
    encoding: 'utf8',
    shell: isWin,
  }).trim();
  stdioJs = path.join(npmRoot, 'posendy-chrome-bridge', 'dist', 'mcp', 'mcp-server-stdio.js');
}
if (!fs.existsSync(stdioJs)) fail(`stdio 서버 없음: ${stdioJs}`);

const mcp = spawn(process.execPath, [stdioJs], {
  env: { ...process.env, CHROME_PORT: String(PORT) },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let out = '';
let mcpErr = '';
mcp.stderr.on('data', (d) => (mcpErr += d.toString()));
const tools = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`tools/list 30초 무응답. stderr:\n${mcpErr.slice(-2000)}`)),
    30000,
  );
  mcp.stdout.on('data', (d) => {
    out += d.toString();
    let i;
    while ((i = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, i).trim();
      out = out.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        mcp.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
        );
        mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
      } else if (msg.id === 2) {
        clearTimeout(timer);
        resolve(msg.result?.tools || []);
      }
    }
  });
  mcp.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'install-smoke', version: '1' },
      },
    }) + '\n',
  );
}).catch((e) => fail(e.message));

if (tools.length < 20) fail(`도구 수가 너무 적음: ${tools.length}`);
const names = tools.map((t) => t.name);
for (const must of ['chrome_navigate', 'chrome_screenshot', 'chrome_read_page']) {
  if (!names.includes(must)) fail(`필수 도구 없음: ${must}`);
}
ok(`stdio MCP tools/list ${tools.length}개`);

mcp.kill();
host.kill();
if (isWin) {
  try {
    execFileSync('taskkill', ['/pid', String(host.pid), '/t', '/f'], { stdio: 'ignore' });
  } catch {}
}
console.log('\n스모크 테스트 통과');
process.exit(0);
