param([ValidateSet('full','fast','normal','slow')][string]$Speed = 'fast', [switch]$KeepServer, [ValidateSet('agent','mock','hybrid','live')][string]$Mode = 'mock')
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
if (-not (Confirm-TestSession $Mode 3001 'C:\Users\rober\Documents\holodek\holodek-1-world1-test' ($Mode -in 'live','hybrid'))) { 'Test session declined by the user; nothing started.'; exit 0 }
# Re-run the world1 full pass in a VISIBLE incognito Chrome window (port 3001). Archives the previous run's logs first.
$dir = 'C:\Users\rober\Documents\holodek\holodek-1-world1-test'; $run = Join-Path $dir 'world1-run'
Set-Location $dir
$env:HOLODEK_DEFAULT_MODEL = 'gpt-6-luna'
$ts = Get-Date -Format yyyyMMdd-HHmmss; $arch = Join-Path $run "previous-$ts"; New-Item -ItemType Directory -Force $arch | Out-Null
Get-ChildItem $run -Force | Where-Object { $_.Name -notmatch '^(previous-|chrome-|server\.)' } | Move-Item -Destination $arch
Remove-Item -Recurse -Force (Join-Path $run 'chrome-visible-profile') -ErrorAction SilentlyContinue
# Server first: (re)start under pm2 only if it is not answering, then wait for a 200 before opening Chrome.
$url = 'http://localhost:3001/assets/index.html'
function Ready { try { return (Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 5).StatusCode -eq 200 } catch { return $false } }
# Watched run: always (re)start the test server in the requested mode; the driver stops it when the window closes (unless -KeepServer).
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'start-pm2.ps1') -Mode $Mode
$deadline = (Get-Date).AddSeconds(120); while (-not (Ready) -and (Get-Date) -lt $deadline) { Start-Sleep 2 }
if (-not (Ready)) { "server not ready at $url after 120s; pass not started" | Set-Content (Join-Path $run 'driver.log'); exit 1 }
$env:HEADED = '1'; $env:SPEED = $Speed; $env:KEEP_SERVER = $(if ($KeepServer) { '1' } else { '0' })
Start-Job { Start-Sleep 30; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $b.Width,$b.Height; [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save("$using:run\desktop-check.png") } | Out-Null
node drive-cdp.mjs *> (Join-Path $run 'driver.log')
Start-Sleep 35
