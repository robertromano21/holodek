param([string]$Archive = 'C:\Program Files\C64\Vice\vice-3.1.tar.gz')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root '.retort-data\vice10582'
$source = Join-Path $dir 'vice-3.1'
$msbuild = 'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe'
if (!(Test-Path -LiteralPath $source)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    & tar -xzf $Archive -C $dir
    if ($LASTEXITCODE) { throw 'VICE source extraction failed.' }
}
$project = Join-Path $source 'src\arch\win32\vs14'
if (!(Test-Path -LiteralPath (Join-Path $project 'vsid.vcxproj'))) {
    & $msbuild (Join-Path $root 'native\vice10582\mkmsvc.vcxproj') /p:Configuration=Release /p:Platform=x64 "/p:ViceRoot=$source" /verbosity:minimal /nologo
    if ($LASTEXITCODE) { throw 'Modern VICE project-generator build failed.' }
    New-Item -ItemType Directory -Path $project -Force | Out-Null
    Push-Location (Join-Path $source 'src\arch\win32\vs_tmpl')
    try { & (Join-Path $dir 'mkmsvc-modern.exe') -native -14 vice }
    finally { Pop-Location }
    if (!(Test-Path -LiteralPath (Join-Path $project 'vsid.vcxproj'))) { throw 'VICE project generation failed.' }
}
Push-Location $root
try {
    $patch = Join-Path $root 'native\vice10582\vice-3.1.patch'
    & git apply --reverse --check --directory=.retort-data/vice10582/vice-3.1 $patch 2>$null
    if ($LASTEXITCODE) {
        & git apply --check --directory=.retort-data/vice10582/vice-3.1 $patch
        if ($LASTEXITCODE) { throw 'VICE source does not match the supported 3.1 baseline.' }
        & git apply --directory=.retort-data/vice10582/vice-3.1 $patch
        if ($LASTEXITCODE) { throw 'VICE patch failed.' }
    }
} finally { Pop-Location }
& (Join-Path $PSScriptRoot 'build-vice10582.ps1')
