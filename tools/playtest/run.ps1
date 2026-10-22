<#
Holodek playtest: start a test server under pm2, wait until it answers, then drive a scenario in a visible incognito Chrome.
  powershell -ExecutionPolicy Bypass -File tools\playtest\run.ps1 [-Folder <game folder>] [-Port 3001] [-Label world1]
      [-Scenario tools\playtest\scenarios\full-pass.json] [-Speed full|fast|normal|slow] [-Live|-Hybrid] [-DevSandbox] [-Headless] [-StopAfter] [-StartOption 2]
Key: $env:OPENAI_API_KEY, else <Folder>\playtest.key (gitignored). It is never printed and is removed from this shell after pm2 starts.
Logs: <Folder>\playtest-run\ (previous runs move to playtest-run\previous-<timestamp>\). No installs: Node's built-in WebSocket + Chrome.
#>
param(
  [string]$Folder = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [int]$Port = 3001,
  [string]$Label = 'world1',
  [string]$Scenario = (Join-Path $PSScriptRoot 'scenarios\full-pass.json'),
  [ValidateSet('full','fast','normal','slow')][string]$Speed = 'full',
  [switch]$Live,          # real API for every call (otherwise fully local: zero live calls)
  [switch]$Hybrid,        # local by default; only HOLODEK_LIVE_CALLS components / scenario 'live' steps go to the API
  [switch]$DevSandbox,    # enable window.__holodekDev and POST /dev/room on this test server
  [switch]$Headless,
  [switch]$StopAfter,
  [int]$StartOption = 2,
  [int]$ReadyTimeoutSec = 120
)
# --- Permission (user rule): a native Yes/No dialog on the interactive desktop before ANY test session starts. ---
function Confirm-TestSession([string]$Mode, [int]$Port, [string]$Folder, [bool]$UsesKey) {
  if ($env:HOLODEK_TEST_APPROVED -eq '1') { return $true }   # set only by the user himself for a pre-approved run
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }
  $owner.Show(); $owner.Activate()
  $msg = "Start a Holodek test session?`n`nMode: $Mode`nPort: $Port`nFolder: $Folder`nAPI key used: $(if ($UsesKey) { 'YES (real API calls)' } else { 'no (fully local)' })"
  $r = [System.Windows.Forms.MessageBox]::Show($owner, $msg, 'Holodek Test Session', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
  $owner.Close()
  return $r -eq [System.Windows.Forms.DialogResult]::Yes
}
$__mode = $(if ($Live) { 'live' } elseif ($Hybrid -or $env:HOLODEK_LIVE_CALLS) { 'hybrid' } else { 'mock' })
if (-not (Confirm-TestSession $__mode $Port $Folder ($__mode -ne 'mock'))) { 'Test session declined by the user; nothing started.'; exit 0 }
$ErrorActionPreference = 'Stop'
if ($Port -eq 3000) { throw 'Port 3000 is the live gameServer; choose another port.' }
$name = "gameServer-$Label-test"; if ($name -eq 'gameServer') { throw 'Refusing to manage the live gameServer.' }
$run = Join-Path $Folder 'playtest-run'; New-Item -ItemType Directory -Force $run | Out-Null
$ts = Get-Date -Format yyyyMMdd-HHmmss; $arch = Join-Path $run "previous-$ts"
$old = Get-ChildItem $run -Force | Where-Object { $_.Name -notmatch '^(previous-|chrome-)' }
if ($old) { New-Item -ItemType Directory -Force $arch | Out-Null; $old | Move-Item -Destination $arch }
$url = "http://localhost:$Port/assets/index.html"
function Ready { try { return (Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 5).StatusCode -eq 200 } catch { return $false } }
# 1) server first: (re)start the test server under pm2 with autorestart so it stays up (the game quits when its last window closes).
if (-not $env:OPENAI_API_KEY -and ($Live -or $Hybrid -or $env:HOLODEK_LIVE_CALLS)) {
  $keyFile = Join-Path $Folder 'playtest.key'
  if (-not (Test-Path $keyFile)) { throw "No OPENAI_API_KEY in the environment and no $keyFile" }
  $env:OPENAI_API_KEY = (Get-Content -Raw $keyFile).Trim(); $fromFile = $true
}
$env:PORT = "$Port"; $env:HOLODEK_PORT = "$Port"; $env:PLAYTEST_RUN = $run; $env:PLAYTEST_CAPTURE = (Join-Path $run 'model-calls.jsonl')
$env:HOLODEK_DEFAULT_MODEL = 'gpt-6-luna'
$env:PLAYTEST_MODEL_MODE = $(if ($Live) { 'live' } elseif ($Hybrid -or $env:HOLODEK_LIVE_CALLS) { 'hybrid' } else { 'mock' })
$env:HOLODEK_DEV_SANDBOX = $(if ($DevSandbox) { '1' } else { '0' })
if ($env:PLAYTEST_MODEL_MODE -eq 'mock' -and -not $env:OPENAI_API_KEY) { $env:OPENAI_API_KEY = 'sk-local-mock-not-a-key'; $fromFile = $true }  # fully local: no real key needed
$capture = Join-Path $PSScriptRoot 'capture.cjs'
pm2 delete $name 2>$null | Out-Null
pm2 start (Join-Path $Folder 'server.js') --name $name --cwd $Folder --node-args="-r `"$capture`"" --restart-delay 2000 `
  --output (Join-Path $run 'server.out.log') --error (Join-Path $run 'server.err.log') | Out-Null
if ($fromFile) { Remove-Item Env:\OPENAI_API_KEY }
# 2) wait for a 200 before any browser opens
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
while (-not (Ready)) { if ((Get-Date) -gt $deadline) { throw "$name did not answer 200 at $url within $ReadyTimeoutSec s. See: pm2 logs $name --lines 80 --nostream" }; Start-Sleep 2 }
"ready: $url ($name)"
# 3) drive the scenario in our own Chrome (unique debug port, ownership-verified, scoped to the game page)
$env:PLAYTEST_PORT = "$Port"; $env:PLAYTEST_OUT = $run; $env:PLAYTEST_SCENARIO = (Resolve-Path $Scenario).Path; $env:PLAYTEST_SPEED = $Speed
$env:PLAYTEST_HEADLESS = $(if ($Headless) { '1' } else { '0' }); $env:START_OPTION = "$StartOption"
node (Join-Path $PSScriptRoot 'driver.mjs') *> (Join-Path $run 'driver.log')
$code = $LASTEXITCODE
"pass finished (driver exit $code). Logs: $run"
if ($StopAfter) { pm2 stop $name | Out-Null; "stopped $name" } else { "$name left running at $url" }
