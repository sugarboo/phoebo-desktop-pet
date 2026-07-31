---
name: develop-phoebo-desktop-pet
description: Plan, implement, review, test, and package the lightweight Phoebo desktop-pet application built with Tauri 2, vanilla TypeScript Canvas, and a thin Rust platform layer. Use when Codex works on this project’s architecture, animation engine, Codex v2 sprite-atlas compatibility, random behavior scheduler, transparent desktop window, tray controls, performance, Windows portable build, cross-platform adaptations, or future skin extensibility.
---

# Develop Phoebo Desktop Pet

Build a pure desktop pet with no Codex runtime, account, network, task, chat, or automation integration. Keep the initial product deliberately small: bundle Phoebo, play shared Codex v2 sprite animations, poll random actions, expose essential tray/window controls, and preserve clean extension seams for later skins.

## Load the right references

Read each selected reference completely before planning or changing code.

- Always read [product-scope.md](references/product-scope.md) to preserve product boundaries and locked decisions.
- Always read [engineering-standards.md](references/engineering-standards.md) before implementation or review.
- Read [architecture.md](references/architecture.md) for scaffolding, module boundaries, Tauri configuration, IPC, permissions, platform behavior, or packaging.
- Read [animation-contract.md](references/animation-contract.md) for atlas loading, Canvas rendering, frame timing, behavior polling, pointer direction, or skin compatibility.
- Read [implementation-roadmap.md](references/implementation-roadmap.md) when planning a milestone, estimating remaining work, reporting status, validating a build, or preparing a release.

## Preserve the locked decisions

- Use Tauri 2, vanilla TypeScript, Vite, Canvas 2D, and a thin Rust layer.
- Do not introduce React, Vue, Svelte, a state-management framework, a database, a local server, or a sidecar.
- Use the operating-system WebView. Do not bundle a fixed WebView2 runtime.
- Optimize first for the owner’s Windows 10/11 environment while keeping platform-dependent code isolated for macOS and Linux.
- Bundle Phoebo’s static RGBA WebP atlas as the only initial skin. Do not convert it to PNG in the initial release.
- Remove all Codex-facing behavior. Retain `codex-v2` only as the name of an asset-layout compatibility profile.
- Keep skin import, multiple skins, autostart, updater, telemetry, cloud features, and store distribution out of the initial implementation.
- Do not require the original Codex `pet.json`. Use the shared animation profile and an internal `PetSkin` descriptor.

## Follow the milestone workflow

1. Inspect the repository, current milestone, dirty files, and direct dependencies before editing.
2. Map the request to one roadmap milestone. Avoid combining unrelated milestones unless the user asks.
3. Restate affected modules, acceptance checks, and any platform limitation in the working plan.
4. Implement the smallest coherent vertical slice. Keep domain logic independent from Tauri and browser globals.
5. Run proportionate static, unit, Rust, build, visual, interaction, and performance checks from the roadmap.
6. Fix regressions introduced by the slice. Do not hide failures with broad fallbacks or skipped checks.
7. Report changed files, behavior verified, commands and outcomes, remaining risks, and the next milestone.

## Enforce architecture boundaries

- Name engine abstractions by responsibility: `PetSkin`, `AnimationProfile`, `AnimationPlayer`, `CanvasPetRenderer`, `BehaviorScheduler`, `DesktopWindowAdapter`.
- When generating code, add clear, easy-to-understand comments around Tauri concepts, lifecycle decisions, platform boundaries, and non-obvious algorithms so the owner can read the implementation to learn Tauri development. Explain intent and tradeoffs rather than restating obvious syntax.
- Use `phoebo` only for the bundled skin identifier, metadata, asset path, and tests specific to that artwork.
- Keep atlas coordinates, frame counts, durations, and behavior weights in configuration; never scatter row or column literals through rendering code.
- Inject time and randomness into the scheduler so tests are deterministic.
- Keep the animation state machine independent from window movement. An animation may play without moving the native window.
- Put platform-specific behavior behind adapters or Rust `cfg` gates. Do not branch on the operating system throughout domain modules.
- Keep Tauri commands narrow, typed, and permission-scoped. Do not expose generic filesystem or shell execution.
- Load and decode the next atlas before making it active. Preserve the current frame or neutral fallback on failure.

## Keep the runtime light

- Render through one Canvas and one decoded atlas; avoid DOM nodes per frame.
- Schedule near the next frame boundary, then draw once with `requestAnimationFrame` and elapsed-time correction. Do not keep a 60 FPS loop alive between sprite changes.
- Schedule random actions with one cancellable timeout. Pause animation and polling while hidden or suspended.
- Add runtime dependencies only when a current milestone needs them. Prefer small local code over a package for trivial parsing, weighting, or state transitions.
- Keep logging bounded and disable verbose logs in release builds.
- Measure release size, idle CPU, animated CPU, memory stability, and wake-up frequency before calling optimization complete.

## Validate compatibility explicitly

- Accept the current profile only when the decoded atlas is `1536 × 2288`, arranged as `8 × 11` cells of `192 × 208`.
- Treat arbitrary WebP images as incompatible. Future skin replacement may be zero-configuration only for a validated matching profile.
- Keep a future `codex-v1` profile possible, but do not implement it in the initial milestone.
- Test transparent edges, frame cropping, high-DPI scaling, first-frame presentation, action interruption, repeated actions, sleep/resume, tray recovery, and clean exit.
- On Windows portable builds, verify behavior on a machine with the system WebView2 runtime. Do not claim support on machines without it.

## Stop before scope expansion

Request direction before adding a framework, fixed WebView runtime, image-conversion library, auto-updater, installer requirement, network access, telemetry, platform-native per-pixel hit testing, or a generalized plugin system. Document a justified future seam instead of implementing an unused subsystem.
