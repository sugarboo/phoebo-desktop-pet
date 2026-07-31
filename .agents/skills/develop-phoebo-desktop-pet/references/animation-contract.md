# Animation, behavior, and skin contract

## Contents

1. Verified Phoebo source
2. Codex v2 atlas geometry
3. Animation row map
4. Shared animation profile
5. Behavior profile
6. Cadence and transition policy
7. Playback rules
8. Rendering rules
9. Future skin compatibility

## Verified Phoebo source

Initial source asset:

```text
C:\Users\Administrator\.codex\pets\phoebo\spritesheet.webp
```

Verified properties:

- SHA-256: `231C5BE5FB9ED9C1E1F027742FD1500AEEE6018F6ED9C9EAB360ABF34FAAAA70`
- format: static WebP;
- color mode: RGBA;
- dimensions: `1536 × 2288`;
- grid: `8 × 11`;
- cell size: `192 × 208`;
- frame count in the WebP container: `1`;
- transparent RGB residue pixels: `0`;
- Codex sprite profile: version 2.

Copy this source into the project during the asset milestone. Never edit the installed Codex copy in place. Recompute and record the hash if the user intentionally replaces the source.

## Codex v2 atlas geometry

Use zero-based row and column indexes:

```text
sourceX = column * 192
sourceY = row * 208
sourceWidth = 192
sourceHeight = 208
```

The full atlas has 88 cells. The current contract uses 74 cells and leaves 14 transparent cells unused.

Treat row `0`, column `6` as the neutral pose. Do not include it in the idle loop.

Rows `9` and `10` hold 16 directional poses in 22.5-degree increments. Direction `0°` means up, not right.

## Animation row map

| Generic clip ID | Row | Columns | Durations in milliseconds | Playback |
|---|---:|---|---|---|
| `idle` | 0 | 0–5 | 280, 110, 110, 140, 140, 320 | loop |
| `walk-right` | 1 | 0–7 | 120, 120, 120, 120, 120, 120, 120, 220 | loop/controlled |
| `walk-left` | 2 | 0–7 | 120, 120, 120, 120, 120, 120, 120, 220 | loop/controlled |
| `wave` | 3 | 0–3 | 140, 140, 140, 280 | once |
| `jump` | 4 | 0–4 | 140, 140, 140, 140, 280 | once |
| `disappointed` | 5 | 0–7 | 140, 140, 140, 140, 140, 140, 140, 240 | once |
| `waiting` | 6 | 0–5 | 150, 150, 150, 150, 150, 260 | once |
| `scamper` | 7 | 0–5 | 120, 120, 120, 120, 120, 220 | once |
| `inspect` | 8 | 0–5 | 150, 150, 150, 150, 150, 280 | once |
| `look-direction` | 9–10 | 0–7 | pose, not timed clip | pose |

The generic IDs intentionally remove Codex task semantics. Preserve the source row meaning only in documentation and profile compatibility tests.

Directional mapping:

```text
row 9:  0°, 22.5°, 45°, 67.5°, 90°, 112.5°, 135°, 157.5°
row 10: 180°, 202.5°, 225°, 247.5°, 270°, 292.5°, 315°, 337.5°
```

## Shared animation profile

Store geometry and timing once in:

```text
src/config/animation-profiles/codex-v2.animations.json
```

Recommended shape:

```json
{
  "schemaVersion": 1,
  "id": "codex-v2",
  "atlas": {
    "width": 1536,
    "height": 2288,
    "columns": 8,
    "rows": 11,
    "frameWidth": 192,
    "frameHeight": 208,
    "neutralFrame": { "row": 0, "column": 6 }
  },
  "clips": {
    "idle": {
      "playback": "loop",
      "frames": [
        { "row": 0, "column": 0, "durationMs": 280 },
        { "row": 0, "column": 1, "durationMs": 110 },
        { "row": 0, "column": 2, "durationMs": 110 },
        { "row": 0, "column": 3, "durationMs": 140 },
        { "row": 0, "column": 4, "durationMs": 140 },
        { "row": 0, "column": 5, "durationMs": 320 }
      ]
    }
  },
  "directions": {
    "startAngleDegrees": 0,
    "stepDegrees": 22.5,
    "frames": [
      { "row": 9, "column": 0 },
      { "row": 9, "column": 1 }
    ]
  }
}
```

Populate every verified clip and all 16 direction frames before declaring the animation-profile milestone complete. Use a handwritten parser with clear validation errors rather than adding a general JSON-schema runtime dependency.

Validate:

- positive integer geometry;
- exact atlas/profile dimensions;
- unique clip IDs;
- nonempty frame lists;
- in-bounds row and column values;
- positive finite durations for timed clips;
- one neutral frame;
- valid playback values;
- exactly 16 unique direction poses when directions are present.

## Behavior profile

Keep random scheduling separate from sprite geometry:

```text
src/config/behaviors/default.behavior.json
```

Recommended shape:

```json
{
  "schemaVersion": 2,
  "id": "default",
  "defaultClipId": "idle",
  "idleDelayMs": {
    "minimum": 60000,
    "maximum": 120000
  },
  "cadence": {
    "avoidImmediateRepeat": true,
    "settleBeforeActionMs": 120,
    "settleAfterActionMs": 180
  },
  "actions": [
    {
      "clipId": "wave",
      "weight": 18,
      "cooldownMs": 12000,
      "interruptible": false
    },
    {
      "clipId": "jump",
      "weight": 12,
      "cooldownMs": 15000,
      "interruptible": false
    },
    {
      "clipId": "waiting",
      "weight": 30,
      "cooldownMs": 6000,
      "interruptible": true
    },
    {
      "clipId": "inspect",
      "weight": 20,
      "cooldownMs": 9000,
      "interruptible": true
    }
  ]
}
```

Treat initial weights as tuning values, not API guarantees. Keep locomotion clips out of the random pool until native window movement is implemented and tested. A stationary window may still use `scamper` as a playful in-place clip if it looks visually coherent.

Validate:

- referenced clip IDs exist;
- weights are finite and greater than zero;
- delay bounds are ordered and nonnegative;
- settle durations are finite, nonnegative, and no greater than `500 ms`;
- cooldowns are nonnegative;
- at least one action is eligible;
- the default clip exists and is loopable.

## Cadence and transition policy

Treat perceived rhythm as part of correctness, not incidental random tuning.

- Sample the next idle delay only after the previous action has returned to `idle`.
  Apply the same `60000–120000 ms` range before the first random action.
- When two or more actions are cooldown-eligible, temporarily exclude the most
  recently started action. Allow it when it is the only eligible action rather than
  stalling the scheduler.
- Let the scheduler select and queue an action, but let `PetRuntime` start it only
  when the idle loop reaches its next cycle boundary. Keep boundary reporting in
  `AnimationPlayer`; do not teach `BehaviorScheduler` about frames.
- At the idle boundary, render the animation profile's neutral pose for the
  configured pre-action settle, then start the one-shot. After its authored final
  hold, render neutral for the configured post-action settle, restart idle at frame
  zero, and only then schedule the next delay.
- Start an action's cooldown when playback actually begins, not when it first
  becomes pending.
- Keep `settleBeforeActionMs` and `settleAfterActionMs` configurable. If visual QA
  shows that neutral creates a double snap for this atlas, set the corresponding
  value to zero while retaining boundary-aligned switching.
- Implement each settle with one cancellable timeout followed by one
  `requestAnimationFrame` draw. Do not introduce a resident 60 FPS loop or alpha
  cross-fade by default; cross-fading non-aligned sprite poses can create ghosting.

## Playback rules

- Start on the neutral frame while loading, then enter `idle`.
- Schedule the next frame boundary with one cancellable timer, render the changed frame in one `requestAnimationFrame`, and use `performance.now()` to correct timer drift.
- Notify a loop boundary before drawing the first frame of the next loop. A listener
  may replace that clip, so recheck playback ownership before drawing or scheduling.
- Let a one-shot action finish unless shutdown, hide, pause, or an explicitly higher-priority user action cancels it.
- Emit one completion notification per action generation.
- Return to `idle` before scheduling the next action.
- Preserve remaining frame time across short pauses only if doing so is simple and tested; otherwise restart `idle` on resume.
- Cap a single elapsed-time catch-up to prevent hundreds of frame advances after system sleep.
- Make the scheduler’s clock and random source injectable.

## Rendering rules

- Decode the whole WebP once; do not split it into PNG frame files.
- Use the nine-argument `drawImage` overload to crop a source cell.
- Render the `192 × 208` source cell into a `120 × 130` logical-pixel
  destination configured in `src/config/pet-viewport.json`. Keep these two size
  contracts separate.
- Clear the full backing canvas before drawing.
- Calculate logical dimensions separately from backing-store dimensions.
- Rebuild backing dimensions on device-pixel-ratio or scale changes.
- Avoid fractional source coordinates.
- Keep destination positioning deterministic so transparent padding does not make the pet jitter.
- Do not infer frame bounds from nontransparent pixels at runtime.

## Future skin compatibility

The first release composes this internal skin:

```ts
const defaultSkin: PetSkin = {
  id: "phoebo",
  displayName: "Phoebo",
  animationProfileId: "codex-v2",
  assetSource: {
    kind: "bundled",
    url: phoeboAtlasUrl
  }
};
```

Do not consume the original Codex `pet.json`.

A future zero-configuration replacement is valid only when the imported image:

- successfully decodes as WebP;
- preserves alpha;
- is exactly `1536 × 2288`;
- satisfies all required used and unused cells;
- passes a visual probe;
- is associated with `codex-v2`.

Optionally detect `1536 × 1872` as a future `codex-v1` candidate, but reject it until that profile and fallback behavior are implemented.

Name imported files by content hash or load them through a new Blob URL. Never overwrite the current path and assume every platform WebView invalidates its cache.
