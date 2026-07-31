# Engineering implementation standards

## Contents

1. Naming and extensibility
2. Type and configuration rules
3. State, time, and lifecycle
4. Dependency policy
5. Tauri and Rust boundaries
6. Error handling and logging
7. Security
8. Testing and review
9. Performance discipline
10. Change hygiene

## Naming and extensibility

- Use English identifiers and descriptive domain terms.
- Name types by capability, not by the first skin.
- Reserve `phoebo` for `DEFAULT_PET_ID`, bundled metadata, asset paths, and artwork-specific tests.
- Use `codex-v2` only as an animation-layout profile ID. Never use `CodexClient`, `CodexState`, or similar runtime concepts.
- Prefer `animationProfile`, `behaviorProfile`, `activeSkin`, `currentClip`, `frameIndex`, and `nextActionAt`.
- Avoid ambiguous names such as `data`, `item`, `obj`, `manager`, `util`, `handler2`, or `temp` outside tiny local scopes.
- Keep persisted and serialized IDs stable, lowercase, and kebab-case.
- Separate visual skin, animation profile, behavior profile, and native-window behavior even when each initially has one implementation.
- Avoid speculative base classes and factories. Prefer interfaces at real I/O or platform seams and concrete modules internally.

## Type and configuration rules

- Enable strict TypeScript settings.
- Do not use `any`; use `unknown` at untrusted boundaries and narrow it.
- Parse JSON once into readonly typed domain objects.
- Reject malformed configuration early with a path-specific diagnostic.
- Keep magic coordinates, timings, weights, and cooldowns out of executable code.
- Use discriminated unions for finite states and asset-source kinds.
- Make impossible state transitions unrepresentable where practical.
- Validate IPC payloads in Rust or at both sides of the boundary.
- Keep JSON `schemaVersion` independent from `animationProfile.id`.

## State, time, and lifecycle

- Give each mutable state one owner.
- Let `PetRuntime` coordinate; let the player own playback state and the scheduler own action-selection state.
- Inject clocks and random sources instead of calling globals throughout domain code.
- Use monotonic time for animation and cooldown calculations.
- Represent cancellation explicitly with a generation token, abort signal, or owned timeout handle.
- Register each event listener once and return or retain its disposer.
- Make shutdown idempotent.
- Pause animation and scheduling when hidden; resume through one defined state transition.
- Cap sleep/resume catch-up and reset to idle if state is uncertain.
- Never create timers or listeners inside a render-frame callback.

## Dependency policy

Before adding a runtime dependency:

1. Identify the concrete current requirement.
2. Estimate runtime, binary, permission, and maintenance cost.
3. Check whether a small local implementation is clearer.
4. Confirm the package is actively maintained and compatible with the selected Tauri version.
5. Add only required features.

Initial forbidden or deferred categories:

- frontend frameworks;
- state-management libraries;
- animation libraries;
- random/weighted-choice packages;
- schema-validation runtimes;
- image-conversion libraries;
- databases;
- HTTP clients;
- local servers;
- shell/process plugins;
- updater and telemetry SDKs.

Development-only test and lint dependencies do not affect runtime size, but still require a clear role.

## Tauri and Rust boundaries

- Keep the Rust entry point small.
- Prefer Tauri’s typed window/tray APIs over custom native bindings.
- Create custom commands only for operations that cannot safely remain in the frontend API.
- Do not create a generic “execute” command.
- Do not pass arbitrary paths from JavaScript into unrestricted Rust filesystem operations.
- Keep OS-specific code in focused modules guarded by `cfg`.
- Native Windows dragging releases WebView pointer capture. Use native window-move events for direction and a narrow `cfg(windows)` left-button query for release state; do not make DOM `pointermove` or `pointerup` the correctness path.
- Return structured, serializable errors without internal secrets or absolute user paths when not needed.
- Do not block the Tauri main thread with file decoding, waits, or long work.
- Review `tauri.conf.json` and capability files in every platform-facing change.

## Error handling and logging

- Treat atlas/config failure as recoverable enough to keep tray quit available.
- Preserve the previous valid skin during a future failed replacement.
- Include error category, failed field or operation, and actionable context.
- Avoid catch-all fallback values that conceal an invalid profile.
- Avoid automatic retry loops for deterministic local failures.
- Keep expected cancellation out of error logs.
- Gate debug diagnostics by build mode.
- Never log image bytes, user file contents, or broad filesystem listings.

## Security

- Load no remote page or script.
- Keep content security policy restrictive.
- Grant only commands and paths required by the active milestone.
- Do not expose the user home directory, Codex directory, shell, process list, or network.
- Treat a future imported atlas as untrusted input: limit file size, decode safely, verify dimensions, and activate only after validation.
- Store future imported files under an application-owned directory with content-hashed names.
- Do not execute or interpret metadata from a pet pack.

## Testing and review

### Unit-test seams

- animation-profile parser;
- frame-coordinate calculation;
- elapsed-time frame selection;
- looping and one-shot completion;
- cancellation and stale callback prevention;
- weighted selection with seeded randomness;
- cooldown eligibility;
- position clamping;
- settings parsing if persistence is added.

### Manual desktop checks

- transparent background and edge quality;
- no first-frame white flash;
- correct visual clip for every animation ID;
- high-DPI appearance;
- drag and focus behavior;
- always-on-top;
- taskbar/tray recovery;
- repeated hide/show and pause/resume;
- monitor and resolution changes;
- sleep/resume;
- release execution outside the repository;
- clean process exit.

In reviews, prioritize correctness, lifecycle leaks, permissions, platform assumptions, and regression risk over style preferences.

## Performance discipline

- Measure release builds, not development mode.
- Record operating system, CPU, display scale, WebView version, and sampling interval with measurements.
- Separate WebView processes from the Rust process when explaining memory.
- Compare stabilized values over time instead of one transient sample.
- Keep one canvas, one image, at most one active frame-boundary timer, and at most one scheduler timeout.
- Avoid allocations and JSON parsing inside the frame loop.
- Avoid redraws while the displayed pose has not changed.
- Pause work when hidden or paused.
- Optimize only after identifying the dominant cost.

## Change hygiene

- Inspect the worktree before editing.
- Preserve unrelated user changes.
- Keep milestones and commits focused if the user asks for Git history.
- Do not initialize Git, create branches, commit, or push unless requested.
- Do not edit the installed source pet under `C:\Users\Administrator\.codex\pets`.
- Keep generated build artifacts, logs, screenshots, and temporary performance captures out of source unless intentionally retained as fixtures.
- Report exactly what was tested; never equate compilation with visual or lifecycle validation.
