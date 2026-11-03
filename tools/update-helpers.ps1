$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $root '.retort-data\helper-updater\current.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No verified helper update is ready. Do not restart yet.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$installer = [System.IO.Path]::GetFullPath((Join-Path $root $manifest.installer))
if (-not $installer.StartsWith(($root + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The installer must be inside the Holodek project.'
}
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.installerHash) {
    throw 'The helper updater changed after verification. Do not restart yet.'
}
Write-Host 'Checking the exact verified PC release and all three selected local or website helpers...'
Write-Host ("Verified engine: {0}" -f $manifest.engineHash)
# Authored-text policy and quest handoff must use the same verified engine on every helper.
& node $installer --helpers
if ($LASTEXITCODE -eq 2) {
    Write-Warning 'Update paused before deployment: restart only gameServer, then run this command again before opening the game. Leave gameServer2 untouched.'
    exit 2
}
if ($LASTEXITCODE -ne 0) { throw 'Helper update did not finish. Keep gameServer running and report the error above; do not restart it again.' }
