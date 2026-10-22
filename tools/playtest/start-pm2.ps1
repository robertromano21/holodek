# Starts the world1 test copy under pm2 as gameServer-world1-test on PORT=3001. Never touches gameServer. Never prints the key.
param([ValidateSet('agent','mock','hybrid','live')][string]$Mode = 'agent')
$ErrorActionPreference = 'Stop'
$dir = 'C:\Users\rober\Documents\holodek\holodek-1-world1-test'
Set-Location $dir
$env:HOLODEK_DEFAULT_MODEL = 'gpt-6-luna'
New-Item -ItemType Directory -Force -Path (Join-Path $dir 'world1-run') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dir 'playtest-run\agent-queue') | Out-Null
$env:PLAYTEST_RUN = (Join-Path $dir 'playtest-run'); $env:PLAYTEST_CAPTURE = (Join-Path $dir 'playtest-run\model-calls.jsonl')
$env:HOLODEK_MODEL_MODE = $(if ($Mode -eq 'agent') { 'agent' } else { '' }); $env:PLAYTEST_MODEL_MODE = $(if ($Mode -eq 'agent') { 'mock' } else { $Mode })
$env:HOLODEK_DEV_SANDBOX = '1'; $env:HOLODEK_CAMPAIGN_BUILDER = '1'
# The key is only loaded for live/hybrid; agent and mock modes make no API calls.
$env:OPENAI_API_KEY = $(if ($Mode -in 'live','hybrid') { (Get-Content -Raw (Join-Path $dir 'world1-test.key')).Trim() } else { 'sk-local-mock-not-a-key' })
$env:PORT = '3001'; $env:HOLODEK_PORT = '3001'
pm2 delete gameServer-world1-test 2>$null | Out-Null
pm2 start server.js --name gameServer-world1-test --cwd $dir --update-env --node-args="-r ./capture.cjs" --restart-delay 2000 --output (Join-Path $dir 'world1-run\server.out.log') --error (Join-Path $dir 'world1-run\server.err.log') | Out-Null
Remove-Item Env:\OPENAI_API_KEY
$deadline = (Get-Date).AddSeconds(90); $ok = $false
while ((Get-Date) -lt $deadline) { try { if ((Invoke-WebRequest -UseBasicParsing "http://localhost:3001/assets/index.html" -TimeoutSec 5).StatusCode -eq 200) { $ok = $true; break } } catch {}; Start-Sleep 2 }
if (-not $ok) { throw "gameServer-world1-test did not answer 200 on http://localhost:3001/assets/index.html within 90s; see pm2 logs gameServer-world1-test" }
"ready: http://localhost:3001/assets/index.html -> 200" 
