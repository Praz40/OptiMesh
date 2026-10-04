param(
    [string]$GodotPath = $env:GODOT_PATH
)
$ErrorActionPreference = 'Stop'
$releaseName = 'OptiMesh-Game-v0.1.1-demo-windows-x86_64'
if (-not $GodotPath) {
    $portable = Join-Path $PSScriptRoot '.tools\godot\Godot_v4.5-stable_win64_console.exe'
    if (Test-Path -LiteralPath $portable) { $GodotPath = $portable }
    else {
        $installed = Get-Command godot, godot.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($installed) { $GodotPath = $installed.Source }
    }
}
if (-not $GodotPath -or -not (Test-Path -LiteralPath $GodotPath)) {
    throw 'Pass -GodotPath with a standard Godot 4.5 stable executable and install its matching export templates.'
}
$engineVersion = (& $GodotPath --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $engineVersion.StartsWith('4.5.stable.')) {
    throw "This release is pinned to Godot 4.5 stable; found '$engineVersion'."
}
$outputDir = Join-Path $PSScriptRoot ('dist\' + $releaseName)
$expectedFiles = @('OptiMesh.exe', 'OptiMesh.pck', 'GODOT-LICENSE.txt', 'GODOT-THIRD-PARTY-NOTICES.txt')
if (Test-Path -LiteralPath $outputDir) {
    $unexpected = Get-ChildItem -LiteralPath $outputDir -Force | Where-Object { $_.PSIsContainer -or $_.Name -notin $expectedFiles }
    if ($unexpected) { throw 'The release output folder contains unexpected files. Use a clean output folder before building.' }
}
New-Item -ItemType Directory -Force $outputDir | Out-Null
$exe = Join-Path $outputDir 'OptiMesh.exe'
& $GodotPath --headless --path $PSScriptRoot --import
if ($LASTEXITCODE -ne 0) { throw 'Godot import failed.' }
& $GodotPath --headless --path $PSScriptRoot --export-release 'Windows Desktop' $exe
if ($LASTEXITCODE -ne 0) { throw 'Windows release export failed. Check the matching Godot 4.5 stable export templates.' }
foreach ($runtimeFile in @($exe, (Join-Path $outputDir 'OptiMesh.pck'))) {
    if (-not (Test-Path -LiteralPath $runtimeFile) -or (Get-Item -LiteralPath $runtimeFile).Length -eq 0) { throw 'Export did not produce the required executable and PCK.' }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'third_party\godot\LICENSE.txt') -Destination (Join-Path $outputDir 'GODOT-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'third_party\godot\COPYRIGHT.txt') -Destination (Join-Path $outputDir 'GODOT-THIRD-PARTY-NOTICES.txt')
$unexpected = Get-ChildItem -LiteralPath $outputDir -Force | Where-Object { $_.PSIsContainer -or $_.Name -notin $expectedFiles }
if ($unexpected) { throw 'Export left unexpected files. Close any running release executable and rebuild in a clean output folder.' }
$zip = Join-Path $PSScriptRoot ('dist\' + $releaseName + '.zip')
Compress-Archive -LiteralPath $outputDir -DestinationPath $zip -CompressionLevel Optimal -Force
Write-Output "Godot: $engineVersion"
Write-Output "Release folder: $outputDir"
Write-Output "ZIP: $zip"
Write-Output ("ZIP bytes: " + (Get-Item -LiteralPath $zip).Length)
Write-Output ("ZIP SHA256: " + (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower())
