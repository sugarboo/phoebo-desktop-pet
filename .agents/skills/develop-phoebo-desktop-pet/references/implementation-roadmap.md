# Development roadmap and verification plan

## Contents

1. Delivery method
2. Milestone 0 — repository foundation
3. Milestone 1 — Tauri shell
4. Milestone 2 — atlas and renderer
5. Milestone 3 — playback and behavior
6. Milestone 3 polish — cadence and transitions
7. Milestone 4 — desktop integration
8. Milestone 5 — robustness and lightweight optimization
9. Milestone 6 — Windows portable release
10. Deferred skin milestone
11. Verification matrix
12. Definition of done

## Delivery method

Complete milestones in order. Keep each milestone buildable and demonstrable. Do not start the next milestone while the current exit checks fail unless the failure is documented as pre-existing or environment-blocked.

For every milestone:

1. Inventory existing source and dirty files.
2. State exact files and behavior in scope.
3. Implement a vertical slice.
4. Run relevant checks.
5. Record evidence and remaining risk.

## Milestone 0 — repository foundation

### Goal

Create a clean project contract before application code.

### Tasks

- Create the project-scoped development skill.
- Record product scope, architecture, animation contract, engineering rules, roadmap, and validation requirements.
- Select the project name `phoebo-desktop-pet`.
- Keep Git initialization and commits separate unless the user requests them.
- Confirm the Phoebo source asset still exists and matches the recorded hash and geometry before copying it later.

### Exit checks

- Skill validation passes.
- No scaffold placeholder markers remain in the skill.
- Every reference linked by `SKILL.md` exists.
- The new project directory contains no unrelated generated application code.

## Milestone 1 — Tauri shell

### Goal

Produce the smallest running transparent Tauri window with a recoverable tray.

### Tasks

- Verify current official Tauri 2 scaffolding guidance before selecting exact dependency versions.
- Scaffold Tauri 2 with Vite and vanilla strict TypeScript.
- Use npm and commit only `package-lock.json`.
- Remove demo UI, icons, styles, commands, and dependencies that are not required.
- Configure a transparent, undecorated, initially hidden, non-resizable `120 × 130` logical window.
- Create the tray and quit path before enabling taskbar hiding.
- Add a transparent canvas and a temporary deterministic placeholder frame.
- Configure the smallest practical Tauri capability set.
- Add size-oriented Rust release settings.

### Exit checks

- Development mode launches without a white background flash.
- Tray show/hide and quit work even when the window is omitted from the taskbar.
- The window can be dragged and remains recoverable.
- Frontend typecheck, Rust formatting, Rust linting, Rust tests, and production build pass.
- Dependency inventory contains no frontend framework, server, sidecar, or unused plugin.

## Milestone 2 — atlas and renderer

### Goal

Render verified Phoebo frames correctly from the bundled WebP.

### Tasks

- Copy the verified source into `src/assets/pets/phoebo/spritesheet.webp`.
- Create the complete `codex-v2.animations.json`.
- Implement typed parsing and structural validation.
- Implement `AtlasLoader`.
- Implement device-pixel-ratio-aware `CanvasPetRenderer`.
- Draw neutral, every timed clip frame, and all direction poses through a developer-only test route or deterministic test harness.
- Show the native window only after the first valid frame.
- Add parser and coordinate unit tests.

### Exit checks

- The copied asset hash is recorded and intentional.
- Atlas decode rejects incorrect dimensions.
- Every frame stays within atlas bounds.
- No adjacent-frame bleed, opaque rectangle, transparent fringe, or frame-position jitter is visible.
- Default, 125%, 150%, 175%, and 200% display scaling remain crisp and correctly sized.
- Production build includes one WebP atlas and no generated PNG frames.

## Milestone 3 — playback and behavior

### Goal

Play accurate animations and select random actions without overlapping timers.

### Tasks

- Implement the elapsed-time `AnimationPlayer`.
- Implement loop, once, pose, cancellation, pause, resume, and completion semantics.
- Create and validate `default.behavior.json`.
- Implement weighted selection and cooldown tracking in `BehaviorScheduler`.
- Inject clock and random sources.
- Integrate the `idle -> action -> idle` state flow.
- Pause work when the document is hidden and handle large elapsed jumps after sleep.
- Add deterministic tests for frame boundaries, cancellation, weights, cooldowns, pause/resume, and stale callbacks.

### Exit checks

- Each clip lasts the sum of its configured frame durations within scheduling tolerance.
- One-shot completion fires exactly once.
- Only one scheduler timeout exists.
- A seeded test produces a repeatable action sequence.
- Ineligible actions are never selected.
- A 30-minute run has no stuck clip, timer multiplication, or monotonically growing listener count.

## Milestone 3 polish — cadence and transitions

### Goal

Apply owner feedback from the successful Milestone 3 soak so random actions feel
calm and clip changes do not interrupt idle motion abruptly.

### Tasks

- Implement the cadence and transition policy from `animation-contract.md`.
- Upgrade the behavior profile to schema version 2 and use a `60000–120000 ms`
  default idle-delay range.
- Suppress an immediate repeat when another cooldown-eligible action exists.
- Let `AnimationPlayer` report an idle-loop boundary without importing behavior
  concepts; let `PetRuntime` own pending-action and neutral-settle transitions.
- Start cooldown accounting when action playback begins.
- Add deterministic tests for boundary queuing, repeat suppression, settle
  cancellation, pause/resume, stale callbacks, and zero-duration settle fallback.

### Exit checks

- The scheduler selects no action sooner than 60 seconds or later than 120 seconds
  after idle is restored; boundary alignment adds no more than one idle-loop cycle.
- The same action is not selected twice consecutively while another action is
  eligible.
- Every configured random action enters and leaves through the documented boundary
  and settle policy, without action-to-action chaining.
- Each active state owns at most its documented timer or RAF, and hidden or paused
  states retain none.
- A real desktop review of every configured action finds no distracting neutral
  flash, double snap, or clipped final hold.
- No dependency, permission, network access, or continuous rendering loop is added.

## Milestone 4 — desktop integration

### Goal

Make the pet practical for daily self-use.

### Tasks

- Implement `DesktopWindowAdapter`.
- Enable drag behavior without requiring animation modules to call Tauri.
- Add tray actions: show/hide, pause/resume, reset position, always-on-top, quit.
- Clamp position to a reachable work area after launch and monitor changes.
- Decide whether focusable behavior needs a Windows-specific adjustment based on runtime testing.
- Persist only approved simple settings if loss of position or pause state is materially annoying.
- Handle second-instance behavior only if it occurs in actual use; avoid an unused plugin by default.

### Exit checks

- The pet does not unexpectedly capture keyboard focus during ordinary use.
- Dragging works from visible character areas and does not leave the pet unreachable.
- Tray actions remain available after repeated hide/show cycles.
- Resolution, DPI, and monitor changes preserve a reachable window.
- Quit ends all application processes promptly.

## Milestone 5 — robustness and lightweight optimization

### Goal

Prove the application is light, quiet, and stable before packaging.

### Tasks

- Add bounded error reporting and a recoverable asset/config failure path.
- Audit active timers, listeners, animation callbacks, IPC handlers, and Blob URLs.
- Pause rendering and random scheduling while hidden.
- Measure cold launch, first visible frame, executable/resources size, CPU, memory, and wake-up behavior.
- Remove unused dependencies, features, commands, assets, source maps, and verbose logging.
- Run a long idle/animation soak and repeated lifecycle test.
- Document platform-specific degradation without adding speculative compatibility code.

### Measurement targets

Treat these as regression budgets measured on the owner’s reference machine, not universal hardware guarantees:

- one bundled pet atlas;
- frontend JavaScript/CSS comfortably below 250 KiB compressed, excluding the atlas;
- initial packaged application comfortably below 20 MiB, excluding a system WebView runtime and debug symbols;
- no network activity;
- near-zero renderer work while hidden or paused;
- no sustained memory growth greater than 10% between stabilized minute 5 and minute 30;
- no additional periodic wake-up faster than the active animation cadence or next behavior timeout.

Record actual values. If a target is missed, profile before changing frameworks or adding native rendering.

### Exit checks

- Clean production build.
- No unexpected outbound connection.
- No broad Tauri capability.
- No release console spam.
- No leak signature in the soak test.
- Measurements and test environment are recorded.

## Milestone 6 — Windows portable release

### Goal

Produce a personal-use Windows release that relies on installed WebView2.

### Tasks

- Build the release executable without bundling fixed WebView2.
- Confirm whether Tauri resource layout permits a single-file handoff; if resources remain external, package a small portable folder or zip and describe it accurately.
- Test from a clean ordinary user directory outside the repository.
- Test a path containing spaces and non-ASCII characters.
- Verify Windows Defender/SmartScreen behavior and distinguish unsigned-app warnings from functional defects.
- Record required Windows and WebView2 assumptions.
- Keep installer, signing, and updater work deferred.

### Exit checks

- Launch, tray, animation, drag, pause, hide/show, reset, and quit all pass from the release artifact.
- No developer tools, Node.js, Rust toolchain, or Codex installation is required at runtime.
- System WebView2 is the only external runtime assumption.
- The artifact can be removed by deleting its executable or portable folder; document any settings stored in application-local data.

## Deferred skin milestone

Do not implement this during the initial release. Preserve the interfaces and use this order later:

1. Add an explicit file-selection flow.
2. Restrict access to the selected file or application-owned pet directory.
3. Load bytes through an opaque source.
4. Decode and validate against registered profiles.
5. Preview before activation.
6. Copy with a content-hash filename.
7. Switch atomically and revoke old resources.
8. Persist an internal registry generated by the application.

Do not resurrect the Codex `pet.json`. If metadata becomes useful, define an optional standalone `pet-pack.json` owned by this application.

## Verification matrix

| Area | Automated checks | Manual checks |
|---|---|---|
| Profile parsing | valid/invalid geometry, bounds, IDs, durations | diagnostic readability |
| Renderer | crop calculations, DPR calculations | transparency, bleed, jitter, scaling |
| Player | elapsed boundaries, loop, once, cancel, pause | perceived cadence |
| Scheduler | seeded weights, cooldowns, stale callbacks | calm/random behavior over time |
| Window | adapter contract where mockable | drag, focus, always-on-top, reachability |
| Tray | command dispatch where mockable | hide/show recovery and quit |
| Lifecycle | cleanup unit tests | sleep/resume, 30-minute soak, repeated launch |
| Security | capability/config inspection | no unexpected prompts or connections |
| Release | typecheck, tests, Rust checks, production build | run artifact outside repository |

Use representative commands after scaffolding:

```text
npm run typecheck
npm test
npm run build
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
npm run tauri build -- --no-bundle
```

Adjust command spelling to the generated scripts, but preserve equivalent coverage.

## Definition of done

A milestone is done only when:

- requested behavior works from the real desktop route;
- relevant automated and manual checks pass;
- new warnings are resolved or explicitly justified;
- permissions and dependencies remain minimal;
- no unrelated user file is changed;
- measurements are reported where required;
- deferred work is clearly separated from completed work;
- the next developer can continue using this skill and the checked-in references.
