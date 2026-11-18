# POSENDY Chrome 자동 설치 스크립트 (Windows)
# 사용법: PowerShell 에 아래 한 줄을 붙여넣고 Enter
#   irm https://raw.githubusercontent.com/scalemaker-ship-it/posendy-chrome/main/install.ps1 | iex
#
# 하는 일
#   1. Node.js 20+ 확인 (없으면 winget 으로 설치)
#   2. 깃허브 릴리스에서 브리지(posendy-chrome-bridge) 전역 설치 (npm 레지스트리 발행 불필요)
#      -> postinstall 이 크롬/엣지 네이티브 메시징 호스트를 HKCU 레지스트리에 등록
#   3. doctor --fix 로 등록 상태 점검, 복구
#   4. 클로드 코드에 MCP 서버 'posendy-chrome' 등록 (claude CLI, 없으면 ~/.mcp.json 병합)
#   5. 크롬 확장 zip 내려받아 문서 폴더에 풀기
#
# 옵션 (irm | iex 로 실행할 때는 기본값을 쓴다)
#   -Version 1.13.1   특정 버전 설치 (기본: 최신 릴리스)
#   -Repo owner/name  다른 저장소의 릴리스 사용
#   -SkipNpm -SkipRegister -SkipDownload  테스트용 단계 건너뛰기
#   -NoOpen           설치 후 탐색기, 크롬을 열지 않음 (CI 용)
param(
  [string]$Version = '',
  [string]$Repo = 'scalemaker-ship-it/posendy-chrome',
  [string]$McpName = 'posendy-chrome',
  [string]$ChromePort = '12330',
  [switch]$SkipNpm,
  [switch]$SkipRegister,
  [switch]$SkipDownload,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # PS 5.1 의 Invoke-WebRequest 진행바는 다운로드를 수십 배 느리게 만든다
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
# 윈도우 10 기본 PowerShell 5.1 은 TLS 1.2 가 꺼져 있어 github.com 접속이 실패할 수 있다
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
if ($env:CI) { $NoOpen = $true }

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  XX  $msg" -ForegroundColor Red; throw $msg }

Write-Host ""
Write-Host "=====================================" -ForegroundColor Magenta
Write-Host "  POSENDY Chrome 자동 설치 (Windows)" -ForegroundColor Magenta
Write-Host "=====================================" -ForegroundColor Magenta

# ---------- 1. Node.js 확인 ----------
Step 1 "Node.js 확인 중..."
$node = Get-Command node -ErrorAction SilentlyContinue
$needNode = $true
if ($node) {
  $ver = (node -v) -replace 'v',''
  if ([int]($ver.Split('.')[0]) -ge 20) { Ok "Node.js $ver 설치되어 있음"; $needNode = $false }
  else { Warn "Node.js 버전이 낮습니다($ver). 20 이상이 필요합니다." }
} else { Warn "Node.js 가 없습니다." }
if ($needNode) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Warn "winget 으로 Node.js LTS 를 설치합니다 (1~2분)..."
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Warn "Node.js 설치 완료. PowerShell 창을 닫고 새로 연 뒤 이 명령을 다시 실행해 주세요."
  } else {
    Warn "https://nodejs.org 에서 LTS 버전을 설치한 뒤 PowerShell 을 새로 열고 다시 실행해 주세요."
  }
  return
}

# ---------- 2. 릴리스 정보 ----------
Step 2 "릴리스 정보 확인 중... ($Repo)"
$api = if ($Version) { "https://api.github.com/repos/$Repo/releases/tags/v$($Version.TrimStart('v'))" } else { "https://api.github.com/repos/$Repo/releases/latest" }
$headers = @{ 'User-Agent' = 'posendy-chrome-installer'; 'Accept' = 'application/vnd.github+json' }
if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
$rel = Invoke-RestMethod -Uri $api -Headers $headers
$tag = $rel.tag_name
$bridgeAsset = $rel.assets | Where-Object { $_.name -like 'posendy-chrome-bridge-*.tgz' } | Select-Object -First 1
$extAsset = $rel.assets | Where-Object { $_.name -eq 'posendy-chrome-extension.zip' } | Select-Object -First 1
if (-not $extAsset) { $extAsset = $rel.assets | Where-Object { $_.name -like '*-chrome.zip' } | Select-Object -First 1 }
if (-not $bridgeAsset) { Fail "릴리스 $tag 에 브리지 파일(posendy-chrome-bridge-*.tgz)이 없습니다." }
if (-not $extAsset) { Fail "릴리스 $tag 에 확장 zip 이 없습니다." }
Ok "릴리스 $tag"

# ---------- 3. 브리지 설치 ----------
if (-not $SkipNpm) {
  Step 3 "연결 프로그램(브리지) 설치 중... (1~3분)"
  # 확장 zip 은 5단계에서 받으므로 postinstall 의 중복 다운로드는 끈다
  $env:AUTO_CHROME_MCP_SKIP_EXTENSION_DOWNLOAD = '1'
  npm install -g $bridgeAsset.browser_download_url --no-fund --no-audit
  $code = $LASTEXITCODE
  Remove-Item Env:\AUTO_CHROME_MCP_SKIP_EXTENSION_DOWNLOAD -ErrorAction SilentlyContinue
  if ($code -ne 0) { Fail "브리지 설치 실패 (npm 종료 코드 $code). 위 npm 오류 메시지를 확인해 주세요." }
  Ok "브리지 설치 완료"

  Step 4 "연결 상태 점검, 수리 중..."
  posendy-chrome-bridge doctor --fix | Out-Host
  if ($LASTEXITCODE -ne 0) { Warn "점검에서 실패 항목이 있습니다. 크롬 확장을 아직 로드하지 않았다면 Connectivity 실패는 정상입니다." }
} else { Step 3 "브리지 설치 건너뜀 (테스트 모드)" }

# ---------- 4. 클로드 코드에 등록 ----------
if (-not $SkipRegister) {
  Step 5 "클로드 코드에 '$McpName' 등록 중..."
  $npmRoot = (npm root -g).Trim()
  $stdioPath = Join-Path $npmRoot "posendy-chrome-bridge\dist\mcp\mcp-server-stdio.js"
  if (-not (Test-Path $stdioPath)) { Fail "브리지 파일을 찾을 수 없습니다: $stdioPath" }

  $registered = $false
  if (Get-Command claude -ErrorAction SilentlyContinue) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    claude mcp remove --scope user $McpName 2>$null | Out-Null
    claude mcp add --scope user --transport stdio $McpName -e "CHROME_PORT=$ChromePort" -- node "$stdioPath" | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok "클로드 코드 전역 등록 완료 (어느 폴더에서 실행해도 사용 가능)"; $registered = $true }
    else { Warn "claude mcp 등록 실패. 설정 파일 방식으로 대신 등록합니다." }
    $ErrorActionPreference = $prev
  }
  if (-not $registered) {
    # 홈 폴더 .mcp.json 에 병합 (홈 폴더에서 클로드를 실행할 때 적용). 다른 서버 항목은 보존.
    $mcpFile = Join-Path $HOME ".mcp.json"
    $env:POSENDY_MCP_FILE = $mcpFile; $env:POSENDY_STDIO = $stdioPath
    $env:POSENDY_PORT = $ChromePort; $env:POSENDY_MCP_NAME = $McpName
    node -e "const fs=require('fs');const f=process.env.POSENDY_MCP_FILE;let c={};try{c=JSON.parse(fs.readFileSync(f,'utf8').replace(/^﻿/,''))}catch{};c.mcpServers=c.mcpServers||{};c.mcpServers[process.env.POSENDY_MCP_NAME]={type:'stdio',command:'node',args:[process.env.POSENDY_STDIO],env:{CHROME_PORT:process.env.POSENDY_PORT}};fs.writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
    if ($LASTEXITCODE -ne 0) { Fail ".mcp.json 쓰기 실패: $mcpFile" }
    Ok "설정 파일 등록 완료: $mcpFile"
  }
} else { Step 5 "클로드 등록 건너뜀 (테스트 모드)" }

# ---------- 5. 크롬 확장 다운로드 ----------
$extDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "POSENDY-Chrome-확장프로그램"
if (-not $SkipDownload) {
  Step 6 "크롬 확장 프로그램 다운로드 중..."
  $zipTmp = Join-Path $env:TEMP "posendy-chrome-ext-$PID.zip"
  Invoke-WebRequest -Uri $extAsset.browser_download_url -OutFile $zipTmp -UseBasicParsing
  if (Test-Path $extDir) { Remove-Item $extDir -Recurse -Force }
  Expand-Archive -Path $zipTmp -DestinationPath $extDir -Force
  Remove-Item $zipTmp -Force
  if (-not (Test-Path (Join-Path $extDir 'manifest.json'))) { Fail "압축을 풀었지만 manifest.json 이 없습니다: $extDir" }
  Ok "확장 프로그램 준비 완료: $extDir"

  if (-not $NoOpen) {
    Start-Process explorer.exe $extDir
    try { Start-Process "chrome" "chrome://extensions" } catch { Warn "크롬을 직접 열어 주소창에 chrome://extensions 를 입력하세요." }
  }
} else { Step 6 "확장 다운로드 건너뜀 (테스트 모드)" }

# ---------- 안내 ----------
Write-Host ""
Write-Host "=====================================" -ForegroundColor Magenta
Write-Host "  남은 일 2가지 (사람이 직접)" -ForegroundColor Magenta
Write-Host "=====================================" -ForegroundColor Magenta
Write-Host @"

 1. 크롬 '확장 프로그램' 화면(chrome://extensions)에서:
    - 오른쪽 위 '개발자 모드' 스위치 켜기
    - '압축해제된 확장 프로그램을 로드합니다' 클릭
    - 이 폴더 선택: $extDir

 2. 클로드 코드를 껐다가 다시 켜기

 확인: 클로드 코드에서 /mcp 입력 시 $McpName 이 connected 면 성공
 문제가 생기면: PowerShell 에서  posendy-chrome-bridge doctor --fix

"@
