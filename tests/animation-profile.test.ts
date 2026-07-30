import animationProfileDocument from "../src/config/animation-profiles/codex-v2.animations.json" with {
  type: "json",
};
import {
  CODEX_V2_CLIP_IDS,
  type AnimationClip,
  type AtlasFrame,
} from "../src/animation/animation-profile.js";
import { parseAnimationProfile } from "../src/animation/profile-parser.js";
import {
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from "./test-harness.js";

const EXPECTED_FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6] as const;
const EXPECTED_DURATION_TOTALS = [1100, 1060, 1060, 700, 840, 1220, 1010, 820, 1030] as const;
const EXPECTED_CLIPS = {
  idle: {
    playback: "loop",
    frames: [
      [0, 0, 280],
      [0, 1, 110],
      [0, 2, 110],
      [0, 3, 140],
      [0, 4, 140],
      [0, 5, 320],
    ],
  },
  "walk-right": {
    playback: "loop",
    frames: [
      [1, 0, 120],
      [1, 1, 120],
      [1, 2, 120],
      [1, 3, 120],
      [1, 4, 120],
      [1, 5, 120],
      [1, 6, 120],
      [1, 7, 220],
    ],
  },
  "walk-left": {
    playback: "loop",
    frames: [
      [2, 0, 120],
      [2, 1, 120],
      [2, 2, 120],
      [2, 3, 120],
      [2, 4, 120],
      [2, 5, 120],
      [2, 6, 120],
      [2, 7, 220],
    ],
  },
  wave: {
    playback: "once",
    frames: [
      [3, 0, 140],
      [3, 1, 140],
      [3, 2, 140],
      [3, 3, 280],
    ],
  },
  jump: {
    playback: "once",
    frames: [
      [4, 0, 140],
      [4, 1, 140],
      [4, 2, 140],
      [4, 3, 140],
      [4, 4, 280],
    ],
  },
  disappointed: {
    playback: "once",
    frames: [
      [5, 0, 140],
      [5, 1, 140],
      [5, 2, 140],
      [5, 3, 140],
      [5, 4, 140],
      [5, 5, 140],
      [5, 6, 140],
      [5, 7, 240],
    ],
  },
  waiting: {
    playback: "once",
    frames: [
      [6, 0, 150],
      [6, 1, 150],
      [6, 2, 150],
      [6, 3, 150],
      [6, 4, 150],
      [6, 5, 260],
    ],
  },
  scamper: {
    playback: "once",
    frames: [
      [7, 0, 120],
      [7, 1, 120],
      [7, 2, 120],
      [7, 3, 120],
      [7, 4, 120],
      [7, 5, 220],
    ],
  },
  inspect: {
    playback: "once",
    frames: [
      [8, 0, 150],
      [8, 1, 150],
      [8, 2, 150],
      [8, 3, 150],
      [8, 4, 150],
      [8, 5, 280],
    ],
  },
} as const;
const EXPECTED_DIRECTIONS = [
  [9, 0],
  [9, 1],
  [9, 2],
  [9, 3],
  [9, 4],
  [9, 5],
  [9, 6],
  [9, 7],
  [10, 0],
  [10, 1],
  [10, 2],
  [10, 3],
  [10, 4],
  [10, 5],
  [10, 6],
  [10, 7],
] as const;
const EXPECTED_UNUSED_CELLS = [
  "0,7",
  "3,4",
  "3,5",
  "3,6",
  "3,7",
  "4,5",
  "4,6",
  "4,7",
  "6,6",
  "6,7",
  "7,6",
  "7,7",
  "8,6",
  "8,7",
] as const;

test("parses the complete codex-v2 profile", () => {
  const profile = parseAnimationProfile(animationProfileDocument as unknown);

  assertEqual(profile.schemaVersion, 1);
  assertEqual(profile.id, "codex-v2");
  assertDeepEqual(Object.keys(profile.clips), CODEX_V2_CLIP_IDS);
  assertDeepEqual(
    CODEX_V2_CLIP_IDS.map((clipId) => requireClip(profile.clips, clipId).frames.length),
    EXPECTED_FRAME_COUNTS,
  );
  assertDeepEqual(
    CODEX_V2_CLIP_IDS.map((clipId) =>
      requireClip(profile.clips, clipId).frames.reduce(
        (total, frame) => total + frame.durationMs,
        0,
      ),
    ),
    EXPECTED_DURATION_TOTALS,
  );
  assertEqual(profile.directions.frames.length, 16);
});

test("matches every locked codex-v2 frame semantic", () => {
  const profile = parseAnimationProfile(animationProfileDocument as unknown);

  assertDeepEqual(profile.atlas.neutralFrame, { row: 0, column: 6 });
  for (const clipId of CODEX_V2_CLIP_IDS) {
    const clip = requireClip(profile.clips, clipId);
    const expectedClip = EXPECTED_CLIPS[clipId];

    assertEqual(clip.playback, expectedClip.playback);
    assertDeepEqual(
      clip.frames.map((frame) => [frame.row, frame.column, frame.durationMs]),
      expectedClip.frames,
    );
  }
  assertDeepEqual(
    profile.directions.frames.map((frame) => [frame.row, frame.column]),
    EXPECTED_DIRECTIONS,
  );
});

test("references exactly 74 unique codex-v2 atlas cells", () => {
  const profile = parseAnimationProfile(animationProfileDocument as unknown);
  const usedFrames: AtlasFrame[] = [profile.atlas.neutralFrame];

  for (const clipId of CODEX_V2_CLIP_IDS) {
    usedFrames.push(...requireClip(profile.clips, clipId).frames);
  }
  usedFrames.push(...profile.directions.frames);

  const usedCellKeys = new Set(usedFrames.map(frameKey));
  const unusedCellKeys: string[] = [];
  for (let row = 0; row < profile.atlas.rows; row += 1) {
    for (let column = 0; column < profile.atlas.columns; column += 1) {
      const key = `${row},${column}`;
      if (!usedCellKeys.has(key)) {
        unusedCellKeys.push(key);
      }
    }
  }

  assertEqual(usedFrames.length, 74);
  assertEqual(usedCellKeys.size, 74);
  assertDeepEqual(unusedCellKeys, EXPECTED_UNUSED_CELLS);
});

test("rejects geometry that differs from codex-v2", () => {
  const invalidProfile = structuredClone(animationProfileDocument);
  invalidProfile.atlas.columns = 7;
  invalidProfile.atlas.width = 1344;

  assertThrows(
    () => parseAnimationProfile(invalidProfile as unknown),
    "profile.atlas.width",
  );
});

test("rejects a nonpositive timed-frame duration with its field path", () => {
  const invalidProfile = structuredClone(animationProfileDocument);
  invalidProfile.clips.wave.frames[2]!.durationMs = 0;

  assertThrows(
    () => parseAnimationProfile(invalidProfile as unknown),
    "profile.clips.wave.frames[2].durationMs",
  );
});

test("rejects an out-of-bounds frame with its field path", () => {
  const invalidProfile = structuredClone(animationProfileDocument);
  invalidProfile.clips.idle.frames[0]!.row = 11;

  assertThrows(
    () => parseAnimationProfile(invalidProfile as unknown),
    "profile.clips.idle.frames[0].row",
  );
});

test("rejects duplicate direction poses", () => {
  const invalidProfile = structuredClone(animationProfileDocument);
  invalidProfile.directions.frames[1] = {
    ...invalidProfile.directions.frames[0]!,
  };

  assertThrows(
    () => parseAnimationProfile(invalidProfile as unknown),
    "direction poses must use 16 unique atlas cells",
  );
});

function requireClip(
  clips: Readonly<Record<string, AnimationClip>>,
  clipId: string,
): AnimationClip {
  const clip = clips[clipId];
  if (clip === undefined) {
    throw new Error(`Expected clip "${clipId}"`);
  }
  return clip;
}

function frameKey(frame: AtlasFrame): string {
  return `${frame.row},${frame.column}`;
}
