param(
    [string]$ZipPath = (Join-Path $PSScriptRoot 'dist\OptiMesh-Game-v0.1.1-demo-windows-x86_64.zip')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ZipPath)) { throw 'Build the Windows release first, or pass -ZipPath.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $taskExpected = @('OptiMesh.exe', 'OptiMesh.pck', 'GODOT-LICENSE.txt', 'GODOT-THIRD-PARTY-NOTICES.txt') | ForEach-Object { 'OptiMesh-Game-v0.1.1-demo-windows-x86_64/' + $_ }
    $taskActual = @($taskArchive.Entries | ForEach-Object { $_.FullName.Replace('\','/') })
    if ($taskActual.Count -ne 4 -or (Compare-Object $taskExpected $taskActual)) { throw 'ZIP contains unexpected or missing player files.' }
} finally { $taskArchive.Dispose() }
$runId = [Guid]::NewGuid().ToString('N')
$isolation = Join-Path ([IO.Path]::GetTempPath()) ('OptiMesh-release-test-' + $runId)
New-Item -ItemType Directory -Force $isolation | Out-Null
Expand-Archive -LiteralPath $ZipPath -DestinationPath $isolation
$exe = Join-Path $isolation 'OptiMesh-Game-v0.1.1-demo-windows-x86_64\OptiMesh.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'ZIP does not contain the expected standalone executable.' }
$profile = Join-Path $PSScriptRoot ('.tools\release-tests\' + $runId)
$output = Join-Path $PSScriptRoot ('artifacts\release-tests\' + $runId)
$smokeScript = Join-Path $PSScriptRoot 'tests\export_smoke_test.gd'
$previousAppData = $env:APPDATA
$previousCaptureDir = $env:OPTIMESH_CAPTURE_DIR
try {
    $env:APPDATA = $profile
    $reopen = $false
    foreach ($size in @('1920x1080', '1366x768', '1280x720')) {
        $env:OPTIMESH_CAPTURE_DIR = Join-Path $output $size
        New-Item -ItemType Directory -Force $env:OPTIMESH_CAPTURE_DIR | Out-Null
        $log = Join-Path $env:OPTIMESH_CAPTURE_DIR 'release-smoke.log'
        $arguments = @('--resolution', $size, '--script', ('"' + $smokeScript + '"'), '--log-file', ('"' + $log + '"'))
        if ($reopen) { $arguments += @('--', '--reopen') }
        $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory (Split-Path $exe -Parent) -WindowStyle Hidden -PassThru
        $process.WaitForExit()
        $result = Get-Content -LiteralPath $log | Select-String 'EXPORTED RELEASE SMOKE:'
        $taskRuntimeErrors = Get-Content -LiteralPath $log | Select-String '^ERROR:|^SCRIPT ERROR:|ObjectDB instances leaked'
        if ($taskRuntimeErrors) { throw "Exported runtime errors at $size. Inspect $log." }
        if ($process.ExitCode -ne 0 -or -not $result -or $result.ToString() -notmatch ', 0 failures$') {
            throw "Exported release validation failed at $size. Inspect $log."
        }
        Write-Output ("$size — " + $result.ToString())
        $reopen = $true
    }
    Write-Output "Exported build ran from: $isolation"
    Write-Output "Validation evidence: $output"
} finally {
    $env:APPDATA = $previousAppData
    $env:OPTIMESH_CAPTURE_DIR = $previousCaptureDir
}
