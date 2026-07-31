# Phoebo Windows x64 portable release

This release is a personal-use, unsigned Windows x64 application. It targets
Windows 10/11 and uses the system-installed Microsoft Edge WebView2 runtime.
WebView2 is not downloaded, bootstrapped, or embedded by Phoebo.

Phoebo renders in a `120 × 130` logical-pixel window. Random one-shot actions
use a newly sampled `60–120` second idle interval; starting at the next safe idle
loop boundary can add at most one idle cycle to that delay.

## Portable contents

The release ZIP contains:

- `Phoebo.exe` — the complete application, frontend, and Phoebo WebP atlas;
- `README.md` — this release note;
- `SHA256SUMS.txt` — the executable checksum.

No installer, updater, fixed WebView2 runtime, Node.js runtime, sidecar, or external
pet asset is required. Extract the ZIP and run `Phoebo.exe`.

## Tray controls

- **Show / Hide** changes native window visibility and suspends background animation
  work while hidden.
- **Pause Actions / Resume Actions** preserves the current pose and stops animation
  and random-action timers until resumed.
- **Reset Position** centers the pet in the primary reachable monitor work area.
- **Always on Top: On / Off** changes the native window level.
- **Quit** terminates the application.

## Security and privacy

Phoebo loads only packaged local assets. Its Tauri capability grants the main
window only native dragging and receiving the two internal lifecycle events needed
by the tray. There is no filesystem, shell, process, HTTP, clipboard, updater, or
Codex permission.

The frontend has no network API. The Windows WebView2 host is started with
`--disable-background-networking` and `--disable-component-update`; the latter is
necessary because the current WebView2 150 runtime otherwise opens its own delayed
component-update connection even though Phoebo never requests a URL. These browser
switches are implementation details of the installed runtime, so repeat the release
network regression after a major WebView2 update. Microsoft likewise documents
that [WebView2 browser flags can change between runtime
releases](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags).
This per-process switch does not disable Windows or Microsoft Edge from servicing
the shared WebView2 runtime outside Phoebo.

The EXE is intentionally unsigned. Windows SmartScreen can therefore display an
unknown-publisher or reputation warning for a downloaded copy. That warning is a
distribution/signing decision, not evidence that WebView2 or the pet failed to
load. Verify `SHA256SUMS.txt` before choosing whether to run it.

## Removal and local data

Phoebo stores no application settings in this release. Deleting `Phoebo.exe` or
the extracted portable folder removes the application itself.

WebView2 creates its normal browser profile/cache under:

```text
%LOCALAPPDATA%\com.phoebo.desktop-pet\EBWebView
```

That directory is runtime cache, not a Phoebo setting. After quitting Phoebo, it
may also be deleted if complete cache cleanup is desired.

## Builder verification

The authoritative build and runtime measurements for the current source revision
are recorded in `docs/verification-report.md`. They include the final executable
hash and size, frontend asset inventory, test commands, external-path launch,
process cleanup, WebView2 version, CPU/memory soak, and Defender/SmartScreen scope.
The TCP result in that report is a periodic process-tree observation rather than a
packet capture; it does not claim to observe DNS, UDP, or sub-sample transient TCP.
