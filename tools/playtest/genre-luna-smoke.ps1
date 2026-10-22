$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$owner=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false;WindowState='Minimized'}
$owner.Show();$owner.Activate()
$message='Run isolated genre-generation checks with GPT-6 Luna?'+"`n`n"+'Western, sci-fi and underwater: world bible, master prompt, roster and native scene schema.'+"`n"+'12 expected paid API calls; hard limit 24 including retries. No browser, service restart, saved game or Runpod changes.'
$answer=[System.Windows.Forms.MessageBox]::Show($owner,$message,'Holodek Test Session',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question,[System.Windows.Forms.MessageBoxDefaultButton]::Button2)
$owner.Close()
if($answer -ne [System.Windows.Forms.DialogResult]::Yes){Write-Output 'Test declined; no calls made.';exit 0}
$env:HOLODEK_GENRE_SMOKE_APPROVED='1'
$loadedKey=$false
try {
  if(-not $env:OPENAI_API_KEY){
    $key='C:\Users\rober\Documents\holodek\holodek-1-world1-test\world1-test.key'
    if(-not (Test-Path -LiteralPath $key)){throw 'OpenAI test key unavailable.'}
    $env:OPENAI_API_KEY=(Get-Content -LiteralPath $key -Raw).Trim();$loadedKey=$true
  }
  if($env:OPENAI_API_KEY.StartsWith('xai-')){throw 'The test needs an OpenAI key, not an xAI key.'}
  node (Join-Path $PSScriptRoot 'genre-luna-smoke.cjs'); exit $LASTEXITCODE
}
finally {Remove-Item Env:\HOLODEK_GENRE_SMOKE_APPROVED -ErrorAction SilentlyContinue;if($loadedKey){Remove-Item Env:\OPENAI_API_KEY -ErrorAction SilentlyContinue}}
