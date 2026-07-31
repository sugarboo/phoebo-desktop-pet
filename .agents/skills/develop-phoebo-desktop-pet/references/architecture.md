# Technical architecture

## Contents

1. Technology choices
2. Proposed repository layout
3. Runtime components
4. Core data contracts
5. Startup and action flows
6. Tauri window and tray policy
7. Asset loading and future skin import
8. Security and permissions
9. Lightweight build policy
10. Cross-platform isolation

## Technology choices

- **Desktop shell:** Tauri 2.
- **Frontend:** vanilla TypeScript with strict compiler options.
- **Build tool:** Vite.
- **Renderer:** Canvas 2D.
- **Native layer:** minimal Rust for application lifecycle, native window/tray integration, and future restricted file import.
- **Package manager:** npm with one committed lockfile.
- **Configuration:** checked-in JSON for animation and behavior profiles.
- **Testing:** a small TypeScript unit-test runner when domain tests begin, plus Rust unit tests and manual desktop smoke tests.

Do not add a frontend framework. The initial UI is one canvas and no component hierarchy justifies one.

## Proposed repository layout

```text
phoebo-desktop-pet/
├─ .agents/
│  └─ skills/
│     └─ develop-phoebo-desktop-pet/
├─ src/
│  ├─ app/
│  │  ├─ bootstrap.ts
│  │  └─ pet-runtime.ts
│  ├─ animation/
│  │  ├─ animation-player.ts
│  │  ├─ animation-profile.ts
│  │  └─ profile-parser.ts
│  ├─ assets/
│  │  └─ pets/phoebo/spritesheet.webp
│  ├─ behavior/
│  │  ├─ behavior-profile.ts
│  │  └─ behavior-scheduler.ts
│  ├─ config/
│  │  ├─ animation-profiles/codex-v2.animations.json
│  │  └─ behaviors/default.behavior.json
│  ├─ pet/
│  │  ├─ pet-skin.ts
│  │  └─ pet-state.ts
│  ├─ platform/
│  │  ├─ desktop-window-adapter.ts
│  │  └─ tauri-desktop-window.ts
│  ├─ rendering/
│  │  ├─ atlas-loader.ts
│  │  └─ canvas-pet-renderer.ts
│  ├─ main.ts
│  └─ styles.css
├─ src-tauri/
│  ├─ capabilities/default.json
│  ├─ src/lib.rs
│  ├─ src/main.rs
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ index.html
├─ package.json
├─ package-lock.json
├─ tsconfig.json
└─ vite.config.ts
```

Add files only when their responsibilities become real. Combining tiny adjacent modules is acceptable; mixing domain timing logic into `main.ts` or Rust commands is not.

## Runtime components

### `PetRuntime`

Own lifecycle and orchestration only:

1. Parse profiles.
2. Resolve and decode the active skin.
3. Show the native window after the first frame is ready.
4. Start the player and behavior scheduler.
5. Forward pause, resume, visibility, and shutdown events.
6. Own pending-action and configured neutral-settle transitions.

Do not let it calculate frame coordinates or weighted random choices.

### `AtlasLoader`

- Load a bundled URL in the first release.
- Wait for `HTMLImageElement.decode()`.
- Validate natural width and height before activation.
- Return a typed decoded-atlas handle.
- Reject incompatible images with a useful error.
- Avoid an image-processing dependency.

### `CanvasPetRenderer`

- Own exactly one canvas and 2D context.
- Crop one atlas cell with `drawImage`.
- Apply device-pixel-ratio backing resolution while keeping window dimensions in logical pixels.
- Clear the canvas before every frame.
- Keep a consistent smoothing policy appropriate for Phoebo’s non-pixel artwork.
- Render the neutral cell when no clip is active or recovery is required.

### `AnimationPlayer`

- Accept an animation clip ID and playback policy.
- Schedule one cancellable wake-up near the next configured frame boundary.
- Draw the changed frame inside one `requestAnimationFrame` callback and correct timing with accumulated monotonic elapsed milliseconds.
- Advance through per-frame durations without assuming a fixed frame rate.
- Support looping, one-shot completion, cancellation, pause, and resume.
- Notify completion once; never start behavior selection itself.
- Notify loop boundaries before drawing the next cycle's first frame, then tolerate
  a listener replacing the active clip.

### `BehaviorScheduler`

- Select eligible actions by configured weight.
- Respect minimum/maximum idle delay, per-action cooldown, and interruption policy.
- Use one cancellable timeout rather than polling at a high frequency.
- Inject `Clock` and `RandomSource`.
- Keep a selected action pending until `PetRuntime` confirms actual playback; start
  its cooldown at that confirmation.
- Return to the configured default action after one-shot completion.
- Stop completely when paused, hidden, or shutting down.

### `DesktopWindowAdapter`

Expose only domain-relevant operations:

```ts
export interface DesktopWindowAdapter {
  show(): Promise<void>;
  hide(): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
  startDragging(): Promise<void>;
  resetToReachablePosition(): Promise<void>;
}
```

Extend deliberately when click-through, monitor enumeration, or physical roaming becomes an approved feature.

## Core data contracts

```ts
export interface PetSkin {
  id: string;
  displayName: string;
  animationProfileId: string;
  assetSource: PetAssetSource;
}

export type PetAssetSource =
  | { kind: "bundled"; url: string }
  | { kind: "external"; fileId: string };

export interface AnimationFrame {
  column: number;
  row: number;
  durationMs: number;
}

export interface AnimationClip {
  id: string;
  frames: readonly AnimationFrame[];
  playback: "loop" | "once" | "pose";
}
```

Implement only the bundled source initially. Retain the external union member only if it improves the boundary without requiring unused code paths; otherwise add it with the future importer.

Use `DEFAULT_PET_ID = "phoebo"` in composition code. Do not create `PhoeboRenderer`, `PhoeboScheduler`, or `PhoeboWindow`.

## Startup and action flows

### Startup

```text
Tauri setup
  -> create tray and initially hidden transparent window
  -> frontend bootstrap
  -> parse shared profiles
  -> decode and validate Phoebo atlas
  -> draw neutral/idle frame
  -> show window
  -> start scheduler
```

Fail safely: if configuration or atlas decoding fails, log one bounded diagnostic, keep the window hidden or show a minimal recoverable state, retain the tray quit action, and never spin in retry loops.

### Random action

```text
idle hold
  -> scheduler timeout
  -> filter cooldown-eligible actions
  -> weighted selection
  -> queue pending action
  -> next idle-loop boundary
  -> neutral pre-settle
  -> confirm action start and run clip
  -> one completion event
  -> neutral post-settle
  -> default idle clip
  -> schedule next hold
```

Use a generation token or cancellation handle so a stale timeout or completion callback cannot start an action after pause, hide, or shutdown.

## Tauri window and tray policy

Start with a logical content size matching one atlas cell: `192 × 208`. Permit a centralized scale factor later.

Recommended initial window behavior:

- transparent background;
- decorations disabled;
- shadow disabled where supported;
- resizable disabled;
- always on top enabled;
- initially hidden until the first frame;
- omitted from the taskbar after tray recovery is proven;
- no maximize or minimize controls;
- no remote URL.

Do not set global click-through by default because it would prevent direct dragging. If click-through is later added, make it an explicit tray mode with a reliable recovery shortcut or tray command.

Create the tray before relying on a taskbar-hidden window. At minimum expose show/hide, pause/resume, reset position, always-on-top, and quit. Keep labels native and simple; avoid a settings window in the first release.

Clamp restored positions to a reachable work area. Treat monitor removal, resolution changes, and DPI changes as normal inputs, not exceptional corruption.

## Asset loading and future skin import

Bundle Phoebo through Vite in the initial release. Let Vite assign a content-hashed resource name and import its URL from composition code.

For a later external-skin feature:

1. Ask the user to select a WebP.
2. Read only that selected file or copy it into an application-owned pet directory.
3. Decode bytes to a Blob URL.
4. Validate dimensions and profile compatibility.
5. Draw a probe frame.
6. Atomically switch the active skin only after success.
7. Revoke the previous Blob URL.

Do not enable a broad asset-protocol or filesystem scope in anticipation. Prefer application-local data and content-hashed filenames when the feature is implemented.

## Security and permissions

- Package local frontend assets only; deny remote navigation.
- Use a restrictive content security policy compatible with local scripts, styles, images, and Blob images only when external import exists.
- Add Tauri capabilities per concrete command.
- Do not enable shell, process, unrestricted dialog, unrestricted filesystem, HTTP, clipboard, or updater permissions by default.
- Validate all payloads crossing IPC.
- Keep paths and native handles in Rust; pass opaque identifiers to the frontend when future external files require them.
- Never grant access to the Codex configuration directory at runtime.

## Lightweight build policy

Keep Rust’s release profile size-oriented:

```toml
[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

Measure startup before adding lazy-loading complexity. With one atlas and one canvas, eager local loading is simpler and likely faster.

Do not bundle fixed WebView2. Build the Windows executable against the system runtime. Keep a separate installer decision deferred.

Runtime efficiency rules:

- no background network;
- no continuous 60 FPS loop and no active timer while paused or hidden;
- one decoded atlas;
- no frame extraction into dozens of image files;
- no per-frame object churn in the hot path;
- no verbose release logging;
- no automatic file watcher before skin import exists.

## Cross-platform isolation

- Keep animation, behavior, and rendering code platform-neutral.
- Put native window differences in the adapter and Rust configuration.
- Use Rust `cfg(target_os = "...")` only in platform modules.
- Provide a stationary fallback when Linux Wayland blocks reliable global positioning.
- Keep macOS transparency flags in a platform-specific Tauri configuration.
- Test and package on each target operating system; do not assume Windows-built artifacts can be reused elsewhere.
