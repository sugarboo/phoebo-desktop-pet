# Phoebo Desktop Pet

Phoebo is a small, local-only desktop pet for Windows 10/11. It is independent
from Codex and contains no account, chat, task, automation, telemetry, updater, or
network feature.

The application uses Tauri 2, vanilla TypeScript, Canvas 2D, and the operating
system's WebView2 runtime. Phoebo's single RGBA WebP atlas is embedded in the
release executable. The pet renders in a `120 × 130` logical-pixel viewport;
each random one-shot action is sampled after `60–120` seconds of idle time.

## Controls

- Drag Phoebo with the primary mouse button.
- Use the tray menu to show or hide Phoebo.
- Pause or resume random actions without hiding the window.
- Reset Phoebo to the center of a reachable monitor work area.
- Toggle always-on-top behavior.
- Choose Quit to end the application and its WebView2 child processes.

## Run from source

Development requires Node.js 20.19 or newer, npm, the Rust toolchain, and the
Windows prerequisites for Tauri 2:

```powershell
npm install
npm run tauri dev
```

The Rust compiler and Cargo are build-time tools only; users of the portable EXE
do not need Node.js, npm, Rust, Cargo, or Codex.

## Verify and build

```powershell
npm run typecheck
npm test
npm run build
Push-Location src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
Pop-Location
npm run tauri build -- --no-bundle
.\scripts\verify-release.ps1
.\scripts\stage-windows-portable.ps1 -SkipBuild
```

The staging script creates a content-hashed Windows x64 portable folder and ZIP
under `artifacts/`. These generated artifacts are intentionally not source files.
`smoke-windows-release.ps1` is an optional Windows UI Automation check for the
native tray, no-activate dragging, position reset, always-on-top, and clean quit.
Passing `-InactiveMeasurementSeconds 30` also records comparable visible, paused,
and hidden whole-process-tree CPU samples. `measure-windows-release.ps1` records
first-visible latency, CPU, memory, process count, and sampled TCP state for the
requested soak duration; its process/TCP inventory may require an elevated shell.

See [the Windows portable release notes](docs/windows-portable-release.md) for
runtime assumptions, verification evidence, unsigned-app behavior, and cleanup.

## Architecture

- `src/animation` owns elapsed-time sprite playback.
- `src/behavior` owns weighted random selection and cooldowns.
- `src/rendering` decodes and crops one atlas into one DPR-aware Canvas.
- `src/app` coordinates lifecycle without native-window calculations.
- `src/platform` is the narrow frontend Tauri boundary.
- `src-tauri/src` owns the tray, native window policy, and reachability clamping.

Skin metadata, animation timing, and behavior cadence are separate contracts. The
interfaces preserve a future validated skin seam, but importing or managing skins
is deliberately outside this release.
