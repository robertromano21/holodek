param([string]$Song, [switch]$ShowWindow)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root '.retort-data\vice10582\vice-3.1\data'
if (!$Song) { $Song = Join-Path $root '.retort-data\vice10582\auditions\the-ashen-lullaby-6a0f67dcc72885a5\10582-native.sid' }
$Song = (Resolve-Path -LiteralPath $Song).Path
$log = Join-Path $root '.retort-data\vice10582\playback.log'
$visibility = if ($ShowWindow) { 'Normal' } else { 'Hidden' }
$player = Start-Process -FilePath (Join-Path $data 'vsid.exe') -WorkingDirectory $data -WindowStyle $visibility -PassThru -ArgumentList @('-default','-keepenv','-sidenginemodel','10582','-logfile',"`"$log`"","`"$Song`"")
if ($ShowWindow) { Write-Output 'Native 10582 SID playback opened in the separate VSID window. Close that window to stop.' }
else {
    Write-Output 'Native 10582 SID playback. Press Ctrl+C to stop.'
    try { $player.WaitForExit() }
    finally { if (!$player.HasExited) { $player.Kill() } }
}
