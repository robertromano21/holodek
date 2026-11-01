param([switch]$Software)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$owner=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;Text='Holodek Test Session';StartPosition='CenterScreen';Width=500;Height=280}
$label=New-Object System.Windows.Forms.Label -Property @{Left=20;Top=20;Width=450;Height=150;Text="Start the isolated city 3D test?`n`nMode: production WebGL renderer, offline fixture`nPort: random loopback only`nAPI key: none`nLive game and gameServer2: untouched`nDefaults to No after 90 seconds."}
$yes=New-Object System.Windows.Forms.Button -Property @{Left=270;Top=180;Width=80;Text='Yes';DialogResult=[System.Windows.Forms.DialogResult]::Yes}
$no=New-Object System.Windows.Forms.Button -Property @{Left=365;Top=180;Width=80;Text='No';DialogResult=[System.Windows.Forms.DialogResult]::No}
$owner.Controls.AddRange(@($label,$yes,$no));$owner.AcceptButton=$no;$owner.CancelButton=$no
$timer=New-Object System.Windows.Forms.Timer -Property @{Interval=90000}
$timer.add_Tick({$owner.DialogResult=[System.Windows.Forms.DialogResult]::No;$owner.Close()});$timer.Start()
$answer=$owner.ShowDialog();$timer.Stop();$timer.Dispose();$owner.Dispose()
if($answer -ne [System.Windows.Forms.DialogResult]::Yes){'Test session declined; nothing started.';exit 0}
Push-Location (Join-Path $PSScriptRoot '..')
try {if($Software){node tests/run-city-stream-probe.cjs --software}else{node tests/run-city-stream-probe.cjs};exit $LASTEXITCODE}finally{Pop-Location}
