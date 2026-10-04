# Windows exhibition release — v0.1.1-demo

Release: **OptiMesh Game — Exhibition Demo v0.1.1**, marked as a pre-release.

[Download and release notes](https://github.com/DGtao13/OptiMesh-Game/releases/tag/v0.1.1-demo)

## Play

Extract `OptiMesh-Game-v0.1.1-demo-windows-x86_64.zip`, open the extracted folder and run `OptiMesh.exe`. Keep the PCK beside it. No editor, backend, account or repository checkout is required.

The game starts windowed at 1280×720, scales its 1920×1080 logical canvas uniformly, and supports global F11 fullscreen and touch fullscreen controls. Settings/rankings are stored under `%APPDATA%\Godot\app_userdata\OptiMesh Game\`; extracting a new build does not erase them.

## Build configuration

- Engine and export templates: **Godot 4.5 stable**, exact engine version `4.5.stable.official.876b29033`.
- Preset: **Windows Desktop**, standard x86_64 release template, Compatibility renderer.
- Product name: **OptiMesh**; file/product version **0.1.1.0**; game version **0.1.1-demo**.
- Separate executable and PCK. [Godot's Windows export guidance](https://docs.godotengine.org/en/4.5/tutorials/export/exporting_for_windows.html) recommends avoiding PCK embedding for ordinary Windows distribution.
- No custom icon was available; no temporary branding asset was invented.
- No signing certificate is configured. This build is unsigned.
- Tests, documentation/screenshots, legacy regression scene, PowerShell tools and local artifacts are excluded from the PCK. Runtime scripts are compiled/compressed by Godot. Generated binaries/ZIP remain ignored under `dist/`.

## Reproduce

1. Check out tag `v0.1.1-demo`.
2. Install standard Godot **4.5 stable** and its matching **4.5.stable** export templates using Godot's Export Template Manager. The official [archive download page](https://godotengine.org/download/archive/4.5-stable/) provides both. Other Godot versions may produce different builds; this release script checks the pinned engine version.
3. Run:

```powershell
./Build-Windows.ps1 -GodotPath 'C:\Tools\Godot_v4.5-stable_win64_console.exe'
./Test-Release.ps1
```

The builder imports the project, exports the release preset, adds required Godot legal notices, creates the ZIP and prints its size/SHA-256. The export preset contains no credentials or machine-specific paths. Matching templates must be installed in the Godot user-data directory used by the build process.

The official template archive used for this build had SHA-256 `375d83b661794f91746d2dec9b569a99d4d24f85a70c4ec0068aafb18b551d53`, checked against the Godot release asset's published digest. Engine license/third-party notices are preserved from the official `4.5-stable` source tag in `third_party/godot/`; those notices concern the bundled engine and dependencies.

## Player package

```text
dist/
  OptiMesh-Game-v0.1.1-demo-windows-x86_64.zip
  OptiMesh-Game-v0.1.1-demo-windows-x86_64/
    OptiMesh.exe
    OptiMesh.pck
    GODOT-LICENSE.txt
    GODOT-THIRD-PARTY-NOTICES.txt
```

The ZIP contains only that player folder. There is no loose source tree, test harness, editor, screenshot collection or development cache. Godot's generated runtime resource metadata inside the PCK is required packaged game data.

## Exported-build validation

`Test-Release.ps1` extracts the ZIP to a new Windows temporary folder outside the repository and runs the exported executable. The external source test harness loads the game's compiled scene/resources; the harness is not shipped to players. A separate isolated AppData profile avoids affecting real player rankings. Closing/reopening between sizes tests persisted data.

| Rendered size | Exported-template assertions | Outcome |
|---|---:|---|
| 1920×1080 | 24 | Zero failures |
| 1366×768 | 25 | Zero failures, including reopened settings/ranking |
| 1280×720 | 25 | Zero failures, including reopened settings/ranking |

**200 exported checks** pass at all three sizes, including global fullscreen, simulated touch/Guest navigation, onboarding, a full rendered day, results, local persistence and retry. ZIP contents are checked against the exact four-file player package. See [USABILITY.md](USABILITY.md) for root causes, fixes, full regression and rendered review evidence.

Windows Godot 4.5 does not expose the system virtual-keyboard feature. Tap focuses the field; open the Windows touch keyboard manually or choose Use Guest. Physical touchscreen behavior remains unvalidated. The reference controller is illustrative, not the production OptiMesh optimizer.

ZIP bytes: 35,129,175. SHA-256: `c4acafc80c0ed6366fd1fabf69d72eb639055a63d4b60a546f992f80e4690150`.
