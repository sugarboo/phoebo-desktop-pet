# Product scope and locked decisions

## Contents

1. Product definition
2. Initial user experience
3. Functional scope
4. Explicit non-goals
5. Platform policy
6. Acceptance criteria
7. Reserved extensions

## Product definition

Create a small, local-only desktop pet whose first and only bundled character is Phoebo. The application displays Phoebo in a borderless transparent window, plays sprite animations, periodically selects harmless random actions, and offers essential control from a system tray.

The product is independent software. It must not depend on Codex being installed or running and must not read Codex tasks, chats, accounts, settings, processes, logs, network traffic, or APIs.

## Initial user experience

- Launch directly into a decoded neutral or idle Phoebo frame without a white-window flash.
- Keep the pet above ordinary windows by default.
- Let the user drag the pet to a preferred screen position.
- Return to idle after each one-shot random action.
- Preserve a calm cadence; do not animate continuously when an idle hold is appropriate.
- Provide tray actions for show/hide, pause/resume random behavior, reset position, always-on-top, and quit.
- Avoid stealing keyboard focus from the user’s active application where the platform permits.
- Exit fully and release timers, image URLs, listeners, and tray resources.

## Functional scope

### Initial release

- One bundled `phoebo` skin.
- One shared `codex-v2` animation profile.
- One default behavior profile.
- Static RGBA WebP atlas decoding.
- Canvas cropping and animation playback.
- Weighted random action scheduling with cooldowns.
- Transparent, undecorated, non-resizable desktop window.
- Dragging, position clamping, always-on-top, tray recovery, and explicit quit.
- Minimal local settings only if needed for position, scale, pause state, or always-on-top state.
- Windows development and portable executable validation.
- Architecture that can compile on macOS and Linux without leaking platform assumptions into the animation domain.

### Later, only on request

- Importing or switching skins.
- Watching a pet directory for changes.
- A `codex-v1` atlas profile.
- PNG fallback generation for older WebViews.
- Pointer-following use of all 16 look-direction poses.
- Physical screen roaming, edge walking, multi-monitor travel, gravity, or collision behavior.
- Autostart, updater, installer, signing, notarization, store distribution, localization, or accessibility settings UI.

## Explicit non-goals

- No Codex integration of any kind.
- No AI, model call, chat, task state, code review, or work-status visualization.
- No remote API, analytics, telemetry, advertisements, authentication, or cloud synchronization.
- No embedded fixed WebView2 runtime.
- No bundled Node.js runtime or local HTTP server.
- No UI framework, state-management framework, database, sidecar, or plugin marketplace.
- No generalized pet editor in the first release.
- No guarantee that a random WebP image is a valid sprite atlas.
- No Mac App Store or other store submission work while the application is for personal use.

## Platform policy

### Windows

Treat current Windows 10/11 with system WebView2 as the primary acceptance platform. Produce a small release executable without bundling fixed WebView2. Clearly state that the portable executable requires WebView2 to be present.

### macOS

Preserve buildable module boundaries and configuration overrides. Transparent WebView use may require the Tauri macOS private API, so direct signed/notarized distribution is the future path; store acceptance is not a current requirement.

### Linux

Preserve buildable module boundaries. Treat X11/XWayland as the likely full-feature desktop mode. Permit a reduced fixed-position mode on Wayland if global positioning or always-on-top behavior is unavailable.

### Build artifacts

Build separately for each operating system and CPU architecture. Never describe one binary as universally cross-platform.

## Acceptance criteria

The initial release is complete only when all of the following are true:

- It starts without Codex installed or running.
- Phoebo’s bundled WebP validates as the expected atlas and renders with intact transparency.
- Every configured animation crops the intended cells without bleeding into adjacent cells.
- Random behavior can run for 30 minutes without a stuck action, overlapping timer, increasing listener count, or unbounded memory growth.
- Pause, resume, show, hide, reset position, always-on-top, and quit work from the tray.
- Window position remains reachable after display resolution, scale, or monitor topology changes.
- Hidden or suspended state stops unnecessary rendering and behavior wake-ups.
- A production build succeeds without downloading or embedding fixed WebView2.
- The artifact and runtime measurements are recorded instead of described as “lightweight” without evidence.
- No runtime permission grants broad filesystem, shell, network, or process access.

## Reserved extensions

Keep these contracts stable even before their second implementation exists:

- `PetSkin`: identifies artwork and its compatible animation profile.
- `AnimationProfile`: defines atlas geometry, animation clips, frame timing, and optional direction poses.
- `BehaviorProfile`: defines weighted actions, delays, cooldowns, and interruption policy.
- `PetAssetSource`: resolves a bundled URL now and may resolve validated external bytes later.
- `DesktopWindowAdapter`: isolates position, visibility, focus, click-through, and platform limitations.

Do not build registries, plugin loaders, or abstract factories merely because these types exist. Implement one straightforward bundled source and one default profile behind the interfaces.
