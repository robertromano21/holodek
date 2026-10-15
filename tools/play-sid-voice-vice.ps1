param([string]$VoiceScore, [switch]$ShowWindow)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root '.retort-data\vice10582\vice-3.1\data'
if (!$VoiceScore) {
    $latest = Get-ChildItem -LiteralPath (Join-Path $root '.retort-data\voice-scores') -Filter '*.sidvoice' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (!$latest) { throw 'Run node tools/export-sid-voice.cjs first.' }
    $VoiceScore = $latest.FullName
}
$VoiceScore = (Resolve-Path -LiteralPath $VoiceScore).Path
$carrier = Join-Path ($VoiceScore + '.vice') 'silent-carrier.sid'
if (!(Test-Path -LiteralPath $carrier)) { throw 'Run node tools/verify-sid-voice-vice.cjs with this score first to create its silent carrier.' }
$rate = [BitConverter]::ToUInt32([IO.File]::ReadAllBytes($VoiceScore), 16)
$log = Join-Path $root '.retort-data\vice10582\voice-playback.log'
$previous = $env:HOLODEK_SIDVOICE_SCORE
try {
    $env:HOLODEK_SIDVOICE_SCORE = $VoiceScore
    $visibility = if ($ShowWindow) { 'Normal' } else { 'Hidden' }
    $player = Start-Process -FilePath (Join-Path $data 'vsid.exe') -WorkingDirectory $data -WindowStyle $visibility -PassThru -ArgumentList @('-default','-keepenv','-sidenginemodel','10582','-soundrate',"$rate",'-logfile',"`"$log`"","`"$carrier`"")
} finally { $env:HOLODEK_SIDVOICE_SCORE = $previous }
if ($ShowWindow) { Write-Output '64-chip voice register demo opened in our isolated VSID. Close its window to stop.' }
else {
    Write-Output '64-chip SID voice demo. Press Ctrl+C to stop.'
    try { $player.WaitForExit() }
    finally { if (!$player.HasExited) { $player.Kill() } }
}
