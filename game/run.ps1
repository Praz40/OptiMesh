param(
    [string]$GodotPath = $env:GODOT_PATH,
    [switch]$Fullscreen
)
$ErrorActionPreference = 'Stop'
if (-not $GodotPath) {
    $portable = Join-Path $PSScriptRoot '.tools\godot\Godot_v4.5-stable_win64.exe'
    if (Test-Path -LiteralPath $portable) { $GodotPath = $portable }
    else {
        $installed = Get-Command godot, godot.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($installed) { $GodotPath = $installed.Source }
    }
}
if (-not $GodotPath -or -not (Test-Path -LiteralPath $GodotPath)) {
    throw 'Godot 4.5+ is required. Import project.godot in Godot, or pass -GodotPath C:\path\Godot.exe.'
}
$launchArgs = @('--path', $PSScriptRoot)
if ($Fullscreen) { $launchArgs += '--fullscreen' }
& $GodotPath @launchArgs
