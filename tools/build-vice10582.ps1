param([switch]$Baseline)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root '.retort-data\vice10582\vice-3.1'
$project = Join-Path $source 'src\arch\win32\vs14'
$msbuild = 'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe'
if (!(Test-Path -LiteralPath (Join-Path $project 'vsid.vcxproj'))) { throw 'Extract VICE 3.1 and generate its VS14 projects first.' }
foreach ($name in @('debug.h','winid_x86.bat','winid_x64.bat','winid_arm.bat','winid_ia64.bat')) {
    Copy-Item -LiteralPath (Join-Path $source ('src\arch\win32\msvc\' + $name)) -Destination (Join-Path $project $name) -Force
}
if (!$Baseline) {
    foreach ($name in @('holodek10582.h','holodek10582bank.h')) {
        Copy-Item -LiteralPath (Join-Path $root ('native\vice10582\' + $name)) -Destination (Join-Path $source ('src\sid\' + $name)) -Force
    }
}
# Base generates translation headers required by independent libraries. Build it
# first to avoid the old projects' missing cross-project generation dependency.
foreach ($name in @('base','vsid')) {
    & $msbuild (Join-Path $project ($name + '.vcxproj')) /m /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143 /p:WindowsTargetPlatformVersion=10.0 /verbosity:minimal /nologo
    if ($LASTEXITCODE -ne 0) { throw "VICE $name build failed ($LASTEXITCODE)." }
}
Write-Output (Join-Path $source 'data\vsid.exe')
