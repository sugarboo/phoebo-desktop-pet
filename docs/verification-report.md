# Phoebo 0.1.0 verification report

Date: 2026-07-31

Target: Windows x64 portable executable

Candidate SHA-256: `0C6CB53C2162D9F00BD58DC08E7A695F4AA628BCF149C6C7F58B8E6DE1897967`

## Scope

This report records the Milestone 1–6 evidence for the initial personal-use
Windows release. Measurements are reference-machine results, not guarantees for
all hardware. Generated CSV and JSON evidence is kept under
`artifacts/measurements/`; the values needed to interpret the release are copied
into this source-controlled report.

## Candidate inventory

| Item | Result |
|---|---:|
| Executable | `phoebo-desktop-pet.exe` |
| Executable size | 4,508,160 bytes |
| Compressed frontend HTML/JS/CSS | 14,387 bytes |
| Bundled atlas count | 1 WebP |
| Bundled atlas size | 2,408,432 bytes |
| Bundled PNG frames | 0 |
| Source maps | 0 |
| Frontend runtime dependencies | `@tauri-apps/api` only |
| WebView2 packaging | system runtime, install mode `skip` |

The atlas SHA-256 is
`231C5BE5FB9ED9C1E1F027742FD1500AEEE6018F6ED9C9EAB360ABF34FAAAA70`.
The Tauri capability is limited to event listen/unlisten and native window
dragging for the single `main` window.

## Reference environment

| Item | Value |
|---|---|
| OS | Windows 11 Pro for Workstations, 10.0.22621, x64 |
| CPU | Intel Core i5-12600K, 16 logical processors |
| Physical memory | 34,088,599,552 bytes |
| Displays | two 1920 × 1080 displays; secondary at negative X |
| WebView2 runtime | 150.0.4078.105 |
| Node.js / npm | 22.21.0 / 10.9.4 |
| Rust / Cargo | 1.97.1 / 1.97.1 |
| Rust host | `x86_64-pc-windows-msvc` |
| PowerShell | 7.6.3 |

## Automated source and build evidence

- Strict TypeScript typecheck passed.
- All 64 frontend/domain tests passed, including a virtual 30-minute behavior
  run, stale-callback rejection, fail-closed error paths, pause/hide timer
  ownership, the five supported DPR backing stores, viewport/source-geometry
  separation, and desktop-control races.
- `cargo fmt --check`, Clippy with `-D warnings`, and all 7 Rust tests passed.
- The optimized `tauri build --no-bundle` production build passed.
- `verify-release.ps1` passed the `120 × 130` viewport, `60–120` second
  cadence, asset, dependency, capability, window, WebView2,
  background-network switch, and canonical executable hash policies.
- `git diff --check` passed.

## Milestone 4 desktop-integration evidence

- The native window was observed with no activation during ordinary interaction;
  a separate focus probe retained foreground focus.
- A desktop smoke sequence exercised native drag, reset position, always-on-top,
  hide/show, pause/resume, and quit. The exact DPI-aware reset position was
  restored and quit removed the complete Phoebo/WebView2 process tree.
- Twenty repeated lifecycle cycles completed without an orphan process. Tray
  recovery remained available while the taskbar entry was omitted.
- The owner separately confirmed real primary-button dragging, transparency, and
  repeated cross-monitor movement. Those confirmations are recorded below.
- A pre-adjustment run from an external non-ASCII path launched successfully, but
  Windows 11 XAML tray-overflow UI Automation did not deliver synthetic shell
  clicks to the native tray callback, and injected mouse input did not reproduce
  a real drag in that automation session. The already-passing interaction smoke
  covered the same tray and drag code. The final viewport/cadence adjustment did
  not change those interaction paths; its exact-hash candidate separately passed
  native launch and size probes. This is retained as an automation limitation
  rather than reported as another synthetic-input pass.

## Milestone 5 runtime measurements

The following process-tree measurements belong to predecessor candidate
`B2B870137281...`, before the final viewport and cadence adjustment. CPU values
are normalized across 16 logical processors. They remain a historical regression
baseline, not a direct performance measurement of the final candidate.

| Measurement | Two-minute preflight | Thirty-minute soak |
|---|---:|---:|
| First valid visible frame | 452.5 ms | 401.3 ms |
| Samples | 78 | 1,132 |
| Peak process count | 7 | 7 |
| Peak working set | 414,490,624 bytes | 415,862,784 bytes |
| Peak private memory | 202,063,872 bytes | 210,984,960 bytes |
| Average normalized CPU | 0.03695% | 0.02408% |
| TCP measurement unavailable | 0 samples | 0 samples |
| External TCP observations | 0 | 0 |

For the thirty-minute run, stabilized minute-5 and final-minute averages were:

| Memory metric | Minute 5 | Final minute | Growth |
|---|---:|---:|---:|
| Working set | 390,501,214 bytes | 402,259,023 bytes | 3.01% |
| Private memory | 200,576,916 bytes | 209,119,285 bytes | 4.26% |

Both growth figures are below the 10% regression budget. The highest observed
TCP connection count was 8, all local or unspecified; no external endpoint was
observed. A separate pair of 20-second windows measured visible normalized CPU
at 0.02429% and native-hidden normalized CPU at 0%. Static inspection and unit
tests also confirm there is no continuous RAF or interval: active animation
waits until the next frame boundary and performs one RAF, while hidden or paused
states own no animation or behavior timer. All measurement runs ended with zero
remaining Phoebo processes.

The final `0C6CB53C2162...` candidate passed the virtual thirty-minute lifecycle
test, release policy checks, a native launch/exit probe, and an exact native
client-size probe. The full thirty-minute native performance soak was not
repeated for this display-size and configuration-only tuning slice.

## Owner desktop evidence from Milestones 1–3

- Primary-button native dragging was confirmed.
- The black screenshot background was confirmed to be a capture artifact; the
  real window is transparent.
- Before the final size tuning, 125%, 150%, and 175% display scaling had owner
  confirmation for clarity, transparent edges, and fine hair detail.
- Repeated movement between mixed-DPI monitors was confirmed without a visible
  defect.
- The final candidate's native client area measured exactly `120 × 130` at
  96 DPI. Deterministic tests verify backing stores of `120 × 130`,
  `150 × 163`, `180 × 195`, `210 × 228`, and `240 × 260` for 100%, 125%,
  150%, 175%, and 200% respectively.
- Random actions were confirmed to return to idle. The final profile samples a
  60–120 second idle delay, avoids eligible immediate repeats, waits for an idle
  loop boundary, and applies configured 120/180 ms neutral settles. A virtual
  thirty-minute run completed repeated action cycles without exceeding one
  action start per minute.

## Milestone 6 portable artifact

The portable handoff is
`artifacts/Phoebo-0.1.0-windows-x64-0c6cb53c2162.zip`:

| Item | Result |
|---|---|
| ZIP size | 3,394,595 bytes |
| ZIP SHA-256 | `A16AC9D9D91B6F1ACFCF1EF0BE7BD60CA15488C700FB19D840759BF2816ADA3C` |
| Contents | `Phoebo.exe`, `README.md`, `SHA256SUMS.txt` |
| Packaged executable SHA-256 | `0C6CB53C2162D9F00BD58DC08E7A695F4AA628BCF149C6C7F58B8E6DE1897967` |

The packaged executable passed the release-policy verifier and matched the
canonical release executable byte-for-byte. A copy launched from
`%LOCALAPPDATA%\Temp\菲比 便携版 0c6cb53c2162\Phoebo.exe` with `PATH`
restricted to Windows system directories, demonstrating that Node.js, npm,
Rust, Cargo, Codex, and repository files are not runtime requirements. The
installed system WebView2 runtime is the only application runtime assumption.
This release stores no settings, installs no service, and can be removed by
deleting the extracted portable folder.

Release identity uses the published SHA-256 rather than assuming that a later
local rebuild will be byte-for-byte identical.

## Security-test environment

The executable is intentionally unsigned; `Get-AuthenticodeSignature` returned
`NotSigned`. On this reference machine, `SmartScreenEnabled` is `Off`, and no
Microsoft Defender cmdlet, service, `MpCmdRun.exe`, or Security Center antivirus
registration is available. A Defender malware scan and a live SmartScreen
reputation prompt therefore cannot be honestly reported from this machine. The
portable README distinguishes that environment limitation and possible
unknown-publisher warnings from application failures.

## Interpretation limits

- Phoebo application code has no network API and release CSP permits only local
  Tauri IPC. WebView2 is launched with `--disable-background-networking` and
  `--disable-component-update`.
- Runtime network evidence is periodic process-tree TCP observation, not packet
  capture. It does not observe DNS, UDP/QUIC, or TCP connections that begin and end
  entirely between samples.
- Microsoft documents WebView2 browser flags as runtime-version-sensitive. Repeat
  network verification after a major system WebView2 update.
- First-visible timing is a new process start with ordinary warm OS/profile
  caches; it is not a post-reboot cold-disk benchmark.
