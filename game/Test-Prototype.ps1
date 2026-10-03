param(
    [string]$GodotPath = (Join-Path $PSScriptRoot '.tools\godot\Godot_v4.5-stable_win64_console.exe'),
    [switch]$Capture,
    [string]$Resolution = '1920x1080'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $GodotPath)) { throw 'Pass -GodotPath with the path to a Godot 4.5+ executable.' }
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'artifacts') | Out-Null
& $GodotPath --headless --path $PSScriptRoot --script tests/energy_simulation_test.gd
if ($LASTEXITCODE -ne 0) { throw "Energy simulation tests failed (exit $LASTEXITCODE)." }
$testArgs = @('--path', $PSScriptRoot, '--script', 'tests/prototype_test.gd')
if ($Capture) { $testArgs += @('--resolution', $Resolution, '--', '--capture') }
else { $testArgs = @('--headless') + $testArgs }
& $GodotPath @testArgs
if ($LASTEXITCODE -ne 0) { throw "Prototype tests failed (exit $LASTEXITCODE)." }
$testArgs[$testArgs.IndexOf('tests/prototype_test.gd')] = 'tests/demo_loop_test.gd'
& $GodotPath @testArgs
if ($LASTEXITCODE -ne 0) { throw "Demo loop tests failed (exit $LASTEXITCODE)." }
& $GodotPath --headless --path $PSScriptRoot --script tests/management_test.gd
if ($LASTEXITCODE -ne 0) { throw "Management model tests failed (exit $LASTEXITCODE)." }
$testArgs[$testArgs.IndexOf('tests/demo_loop_test.gd')] = 'tests/exhibition_test.gd'
& $GodotPath @testArgs
if ($LASTEXITCODE -ne 0) { throw "Exhibition tests failed (exit $LASTEXITCODE)." }
$testArgs[$testArgs.IndexOf('tests/exhibition_test.gd')] = 'tests/playstyle_test.gd'
& $GodotPath @testArgs
if ($LASTEXITCODE -ne 0) { throw "Playstyle tests failed (exit $LASTEXITCODE)." }
& $GodotPath --headless --path $PSScriptRoot --script tests/polish_test.gd
if ($LASTEXITCODE -ne 0) { throw "Polish regression tests failed (exit $LASTEXITCODE)." }
& $GodotPath --headless --path $PSScriptRoot --script tests/usability_test.gd
if ($LASTEXITCODE -ne 0) { throw "Usability regression tests failed (exit $LASTEXITCODE)." }
