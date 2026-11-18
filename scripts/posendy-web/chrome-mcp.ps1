# POSENDY Chrome MCP 설치 (Windows 10/11)
#
#   PowerShell 에 붙여 넣고 Enter:
#   irm https://posendy.com/install/chrome-mcp.ps1 | iex
#
# 하는 일 (macOS 용 chrome-mcp.sh 와 같은 구조)
#   1. Node.js 20 이상 확인
#   2. 연결 프로그램(브리지)을 %USERPROFILE%\.posendy-chrome\bridge 에 설치
#   3. 크롬 네이티브 메시징 등록 (HKCU 레지스트리, 관리자 권한 없음)
#   4. 확장 파일을 %USERPROFILE%\.posendy-chrome\posendy 에 풀기
#   5. 클로드 코드에 MCP 서버 등록 (claude CLI 가 있을 때)
#
# 환경 변수
#   POSENDY_BASE      내려받을 주소 (기본 https://posendy.com)
#   POSENDY_MCP_NAME  클로드 코드에 등록할 이름 (기본 posendy-chrome)
#   CHROME_PORT       브리지 포트 (기본 12330)
#   POSENDY_NO_OPEN   1 이면 설치 후 탐색기, 크롬을 열지 않음

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$Base = if ($env:POSENDY_BASE) { $env:POSENDY_BASE.TrimEnd('/') } else { 'https://posendy.com' }
$McpName = if ($env:POSENDY_MCP_NAME) { $env:POSENDY_MCP_NAME } else { 'posendy-chrome' }
$ChromePort = if ($env:CHROME_PORT) { $env:CHROME_PORT } else { '12330' }
$HomeDir = Join-Path $env:USERPROFILE '.posendy-chrome'
$BridgeDir = Join-Path $HomeDir 'bridge'
$ExtDir = Join-Path $HomeDir 'posendy'
$ExtId = 'dafdlgggdlfgiojdcjlaclelodbfajpp'
$HostName = 'com.posendy.nativehost'

function Step($n, $m) { Write-Host "`n[$n] $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "  실패  $m" -ForegroundColor Red; throw $m }

Write-Host "`nPOSENDY Chrome MCP 설치 (Windows)" -ForegroundColor White

# 1. Node.js
Step 1 'Node.js 확인'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die 'Node.js 가 없습니다. https://nodejs.org 에서 LTS 를 설치하고 PowerShell 을 새로 연 뒤 다시 실행하세요. (winget install OpenJS.NodeJS.LTS)'
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Die "Node.js 20 이상이 필요합니다. 현재 $(node -v)" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Die 'npm 이 없습니다. Node.js 를 다시 설치하세요.' }
# Git for Windows 의 GNU tar 는 C:\ 경로를 원격 호스트로 읽어 실패한다. 윈도우 내장 bsdtar 를 직접 쓴다.
$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $Tar)) { Die '윈도우 내장 tar.exe 가 없습니다. 윈도우 10 1803 이상이 필요합니다.' }
Ok "Node.js $(node -v)"

New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
$Tmp = Join-Path $env:TEMP ("posendy-chrome-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

try {
  # 2. 브리지
  Step 2 '연결 프로그램(브리지) 설치 (1~3분)'
  $tgz = Join-Path $Tmp 'bridge.tgz'
  try { Invoke-WebRequest -Uri "$Base/downloads/posendy-chrome-bridge.tgz" -OutFile $tgz -UseBasicParsing }
  catch { Die "브리지 파일을 받지 못했습니다: $Base/downloads/posendy-chrome-bridge.tgz" }
  & $Tar -xzf $tgz -C $Tmp
  if ($LASTEXITCODE -ne 0) { Die '브리지 압축을 풀지 못했습니다.' }
  $newBridge = Join-Path $Tmp 'posendy-chrome-bridge'
  if (-not (Test-Path (Join-Path $newBridge 'dist\cli.js'))) { Die '브리지 파일이 손상됐습니다.' }
  Push-Location $newBridge
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  # --install-links: vendor 의 shared 를 링크가 아닌 복사본으로 넣는다. 윈도우 npm 은 file: 의존성을
  # 절대경로 정션으로 만들어, 아래에서 폴더를 옮기고 임시 폴더를 지우면 링크가 끊긴다.
  npm install --omit=dev --install-links --no-audit --no-fund --no-update-notifier --loglevel=error | Out-Host
  $npmCode = $LASTEXITCODE
  $ErrorActionPreference = $prev
  Pop-Location
  if ($npmCode -ne 0) { Die '의존성 설치에 실패했습니다. 네트워크를 확인하고 다시 실행하세요.' }

  # 실행 중인 브리지(크롬이 띄운 node)가 파일을 잡고 있으면 옮기기가 실패할 수 있다
  if (Test-Path $BridgeDir) {
    $prevDir = "$BridgeDir.prev"
    if (Test-Path $prevDir) { Remove-Item $prevDir -Recurse -Force -ErrorAction SilentlyContinue }
    try { Move-Item $BridgeDir $prevDir -Force }
    catch { Die '기존 브리지 폴더를 옮기지 못했습니다. 크롬을 완전히 닫고 다시 실행하세요.' }
  }
  Move-Item $newBridge $BridgeDir
  $sharedPkg = Join-Path $BridgeDir 'node_modules\posendy-chrome-shared\package.json'
  if (-not (Test-Path $sharedPkg)) { Die "브리지 의존성이 빠졌습니다: $sharedPkg" }
  $ver = node -p "require(process.argv[1]).version" (Join-Path $BridgeDir 'package.json')
  Ok "설치 위치: $BridgeDir (v$ver)"

  # 3. 네이티브 메시징 등록 (manifest + HKCU 레지스트리)
  Step 3 '크롬 연결 등록'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  node (Join-Path $BridgeDir 'dist\cli.js') register --force *> $null
  $ErrorActionPreference = $prev
  $key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
  $manifest = $null
  try { $manifest = (Get-ItemProperty -Path $key -ErrorAction Stop).'(default)' } catch {}
  if (-not $manifest -or -not (Test-Path $manifest)) { Die "크롬 연결 등록이 없습니다: $key" }
  $mj = Get-Content -Raw -Encoding UTF8 $manifest
  if ($mj -notmatch $ExtId) { Die "등록 파일에 확장 ID 가 없습니다: $manifest" }
  Ok '등록 완료'

  # 4. 확장
  Step 4 '크롬 확장 파일 준비'
  $zip = Join-Path $Tmp 'ext.zip'
  try { Invoke-WebRequest -Uri "$Base/downloads/posendy-chrome-extension.zip" -OutFile $zip -UseBasicParsing }
  catch { Die '확장 파일을 받지 못했습니다.' }
  $extTmp = Join-Path $Tmp 'ext'
  Expand-Archive -Path $zip -DestinationPath $extTmp -Force
  $src = Join-Path $extTmp 'posendy'
  if (-not (Test-Path $src)) { $src = Join-Path $extTmp 'chrome-mv3' }  # 예전 zip
  if (-not (Test-Path (Join-Path $src 'manifest.json'))) { Die '확장 파일이 손상됐습니다.' }
  # 폴더 위치를 바꾸지 않는다: 같은 자리를 덮어쓰면 확장 화면의 새로고침 한 번으로 업데이트된다
  New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null
  Get-ChildItem -Path $ExtDir -Force | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $src '*') -Destination $ExtDir -Recurse -Force
  Ok "확장 폴더: $ExtDir"

  # 5. 클로드 코드
  Step 5 '클로드 코드에 MCP 등록'
  $stdio = Join-Path $BridgeDir 'dist\mcp\mcp-server-stdio.js'
  $manual = "claude mcp add --scope user --transport stdio $McpName -e CHROME_PORT=$ChromePort -- node `"$stdio`""
  if (Get-Command claude -ErrorAction SilentlyContinue) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    claude mcp remove --scope user $McpName *> $null
    claude mcp add --scope user --transport stdio $McpName -e "CHROME_PORT=$ChromePort" -- node "$stdio" *> $null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -eq 0) { Ok "등록 이름: $McpName (모든 폴더에서 사용)" }
    else { Warn '자동 등록에 실패했습니다. 아래 명령을 직접 실행하세요.'; Write-Host "     $manual" }
  } else {
    Warn 'claude 명령이 없어 등록을 건너뜁니다. 클로드 코드를 설치한 뒤 아래 명령을 실행하세요.'
    Write-Host "     $manual"
  }
} finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not $env:POSENDY_NO_OPEN -and -not $env:CI) {
  try { Start-Process explorer.exe $ExtDir } catch {}
}

Write-Host @"

남은 일 3가지

 1. 크롬 주소창에 chrome://extensions 를 넣고 오른쪽 위 '개발자 모드'를 켭니다.
 2. '압축해제된 확장 프로그램을 로드합니다'를 누르고 이 폴더를 고릅니다.
      $ExtDir
    (방금 탐색기 창으로 이 폴더를 열어 뒀습니다.)
 3. 클로드 코드를 껐다 켜고 /mcp 에 $McpName 이 connected 로 보이면 끝입니다.

 업데이트: 이 명령을 다시 실행하고 chrome://extensions 에서 POSENDY Chrome 의 새로고침을 누르세요.
 점검: node "$BridgeDir\dist\cli.js" doctor

"@
