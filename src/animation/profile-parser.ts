import {
  ANIMATION_PROFILE_SCHEMA_VERSION,
  CODEX_V2_ATLAS_CONTRACT,
  CODEX_V2_CLIP_IDS,
  CODEX_V2_PROFILE_ID,
  type AnimationClip,
  type AnimationPlayback,
  type AnimationProfile,
  type AtlasFrame,
  type AtlasGeometry,
  type DirectionProfile,
  type TimedAnimationFrame,
} from "./animation-profile.js";

type UnknownRecord = Record<string, unknown>;

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLAYBACK_VALUES: readonly AnimationPlayback[] = ["loop", "once", "pose"];
const TOP_LEVEL_KEYS = ["schemaVersion", "id", "atlas", "clips", "directions"] as const;
const ATLAS_KEYS = [
  "width",
  "height",
  "columns",
  "rows",
  "frameWidth",
  "frameHeight",
  "neutralFrame",
] as const;
const FRAME_KEYS = ["row", "column"] as const;
const TIMED_FRAME_KEYS = ["row", "column", "durationMs"] as const;
const CLIP_KEYS = ["playback", "frames"] as const;
const DIRECTION_KEYS = ["startAngleDegrees", "stepDegrees", "frames"] as const;

export class AnimationProfileValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "AnimationProfileValidationError";
    this.path = path;
  }
}

export function parseAnimationProfile(input: unknown): AnimationProfile {
  // Imported JSON is `unknown` at this boundary. Each helper narrows one field and
  // includes its JSON path in errors, making malformed profiles straightforward to fix.
  const profile = expectRecord(input, "profile");
  assertExactKeys(profile, TOP_LEVEL_KEYS, "profile");

  const schemaVersion = expectInteger(
    readRequired(profile, "schemaVersion", "profile"),
    "profile.schemaVersion",
  );
  if (schemaVersion !== ANIMATION_PROFILE_SCHEMA_VERSION) {
    fail(
      "profile.schemaVersion",
      `expected ${ANIMATION_PROFILE_SCHEMA_VERSION}, received ${schemaVersion}`,
    );
  }

  const id = expectIdentifier(readRequired(profile, "id", "profile"), "profile.id");
  if (id !== CODEX_V2_PROFILE_ID) {
    fail("profile.id", `unsupported animation profile "${id}"`);
  }

  const atlas = parseAtlas(readRequired(profile, "atlas", "profile"));
  const clips = parseClips(readRequired(profile, "clips", "profile"), atlas);
  const directions = parseDirections(readRequired(profile, "directions", "profile"), atlas);

  const idle = clips["idle"];
  // Neutral is a loading/recovery pose. Including it in idle would subtly change
  // the verified Codex-v2 animation cadence.
  if (
    idle?.frames.some(
      (frame) =>
        frame.row === atlas.neutralFrame.row && frame.column === atlas.neutralFrame.column,
    )
  ) {
    fail("profile.clips.idle.frames", "must not include the neutral frame");
  }

  return Object.freeze({
    schemaVersion,
    id,
    atlas,
    clips,
    directions,
  });
}

function parseAtlas(input: unknown): AtlasGeometry {
  const path = "profile.atlas";
  const atlas = expectRecord(input, path);
  assertExactKeys(atlas, ATLAS_KEYS, path);

  const width = expectPositiveInteger(readRequired(atlas, "width", path), `${path}.width`);
  const height = expectPositiveInteger(readRequired(atlas, "height", path), `${path}.height`);
  const columns = expectPositiveInteger(
    readRequired(atlas, "columns", path),
    `${path}.columns`,
  );
  const rows = expectPositiveInteger(readRequired(atlas, "rows", path), `${path}.rows`);
  const frameWidth = expectPositiveInteger(
    readRequired(atlas, "frameWidth", path),
    `${path}.frameWidth`,
  );
  const frameHeight = expectPositiveInteger(
    readRequired(atlas, "frameHeight", path),
    `${path}.frameHeight`,
  );

  if (width !== columns * frameWidth) {
    fail(`${path}.width`, "must equal columns multiplied by frameWidth");
  }
  if (height !== rows * frameHeight) {
    fail(`${path}.height`, "must equal rows multiplied by frameHeight");
  }

  assertCodexV2Geometry({
    width,
    height,
    columns,
    rows,
    frameWidth,
    frameHeight,
  });

  const partialGeometry = {
    width,
    height,
    columns,
    rows,
    frameWidth,
    frameHeight,
  };
  const neutralFrame = parseAtlasFrame(
    readRequired(atlas, "neutralFrame", path),
    `${path}.neutralFrame`,
    partialGeometry,
  );

  return Object.freeze({
    ...partialGeometry,
    neutralFrame,
  });
}

function parseClips(input: unknown, atlas: AtlasGeometry): Readonly<Record<string, AnimationClip>> {
  const path = "profile.clips";
  const clipDocuments = expectRecord(input, path);
  const clipIds = Object.keys(clipDocuments);

  for (const requiredClipId of CODEX_V2_CLIP_IDS) {
    if (!Object.hasOwn(clipDocuments, requiredClipId)) {
      fail(`${path}.${requiredClipId}`, "required clip is missing");
    }
  }

  const unexpectedClipId = clipIds.find(
    (clipId) => !CODEX_V2_CLIP_IDS.some((requiredClipId) => requiredClipId === clipId),
  );
  if (unexpectedClipId !== undefined) {
    fail(`${path}.${unexpectedClipId}`, "clip is not part of the codex-v2 contract");
  }

  const clips: Record<string, AnimationClip> = {};
  // Build new immutable domain objects rather than letting runtime code retain and
  // accidentally mutate Vite's imported JSON document.
  for (const clipId of clipIds) {
    expectIdentifier(clipId, `${path}.${clipId}`);
    const clipPath = `${path}.${clipId}`;
    const clipDocument = expectRecord(clipDocuments[clipId], clipPath);
    assertExactKeys(clipDocument, CLIP_KEYS, clipPath);

    const playbackValue = expectString(
      readRequired(clipDocument, "playback", clipPath),
      `${clipPath}.playback`,
    );
    if (!isPlayback(playbackValue)) {
      fail(
        `${clipPath}.playback`,
        `expected one of ${PLAYBACK_VALUES.join(", ")}, received "${playbackValue}"`,
      );
    }

    const frameDocuments = expectArray(
      readRequired(clipDocument, "frames", clipPath),
      `${clipPath}.frames`,
    );
    if (frameDocuments.length === 0) {
      fail(`${clipPath}.frames`, "must contain at least one frame");
    }

    const frames = frameDocuments.map((frameDocument, frameIndex) =>
      parseTimedFrame(frameDocument, `${clipPath}.frames[${frameIndex}]`, atlas),
    );

    clips[clipId] = Object.freeze({
      id: clipId,
      playback: playbackValue,
      frames: Object.freeze(frames),
    });
  }

  return Object.freeze(clips);
}

function parseDirections(input: unknown, atlas: AtlasGeometry): DirectionProfile {
  const path = "profile.directions";
  const directions = expectRecord(input, path);
  assertExactKeys(directions, DIRECTION_KEYS, path);

  const startAngleDegrees = expectFiniteNumber(
    readRequired(directions, "startAngleDegrees", path),
    `${path}.startAngleDegrees`,
  );
  if (startAngleDegrees !== 0) {
    fail(`${path}.startAngleDegrees`, "codex-v2 directions must begin at 0 degrees");
  }

  const stepDegrees = expectPositiveFiniteNumber(
    readRequired(directions, "stepDegrees", path),
    `${path}.stepDegrees`,
  );
  if (stepDegrees !== 22.5) {
    fail(`${path}.stepDegrees`, "codex-v2 direction steps must be 22.5 degrees");
  }

  const frameDocuments = expectArray(
    readRequired(directions, "frames", path),
    `${path}.frames`,
  );
  if (frameDocuments.length !== 16) {
    fail(`${path}.frames`, `expected exactly 16 direction poses, received ${frameDocuments.length}`);
  }

  const frames = frameDocuments.map((frameDocument, frameIndex) =>
    parseAtlasFrame(frameDocument, `${path}.frames[${frameIndex}]`, atlas),
  );
  const uniqueCoordinates = new Set(frames.map(frameKey));
  if (uniqueCoordinates.size !== frames.length) {
    fail(`${path}.frames`, "direction poses must use 16 unique atlas cells");
  }

  return Object.freeze({
    startAngleDegrees,
    stepDegrees,
    frames: Object.freeze(frames),
  });
}

function parseTimedFrame(
  input: unknown,
  path: string,
  atlas: Pick<AtlasGeometry, "rows" | "columns">,
): TimedAnimationFrame {
  const frame = expectRecord(input, path);
  assertExactKeys(frame, TIMED_FRAME_KEYS, path);

  const atlasFrame = parseFrameCoordinates(frame, path, atlas);
  const durationMs = expectPositiveFiniteNumber(
    readRequired(frame, "durationMs", path),
    `${path}.durationMs`,
  );

  return Object.freeze({
    ...atlasFrame,
    durationMs,
  });
}

function parseAtlasFrame(
  input: unknown,
  path: string,
  atlas: Pick<AtlasGeometry, "rows" | "columns">,
): AtlasFrame {
  const frame = expectRecord(input, path);
  assertExactKeys(frame, FRAME_KEYS, path);
  return Object.freeze(parseFrameCoordinates(frame, path, atlas));
}

function parseFrameCoordinates(
  frame: UnknownRecord,
  path: string,
  atlas: Pick<AtlasGeometry, "rows" | "columns">,
): AtlasFrame {
  const row = expectInteger(readRequired(frame, "row", path), `${path}.row`);
  const column = expectInteger(readRequired(frame, "column", path), `${path}.column`);

  if (row < 0 || row >= atlas.rows) {
    fail(`${path}.row`, `must be between 0 and ${atlas.rows - 1}`);
  }
  if (column < 0 || column >= atlas.columns) {
    fail(`${path}.column`, `must be between 0 and ${atlas.columns - 1}`);
  }

  return { row, column };
}

function assertCodexV2Geometry(
  atlas: Omit<AtlasGeometry, "neutralFrame">,
): void {
  for (const key of [
    "width",
    "height",
    "columns",
    "rows",
    "frameWidth",
    "frameHeight",
  ] as const) {
    const expected = CODEX_V2_ATLAS_CONTRACT[key];
    if (atlas[key] !== expected) {
      fail(`profile.atlas.${key}`, `codex-v2 requires ${expected}, received ${atlas[key]}`);
    }
  }
}

function expectRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "expected a plain object");
  }

  return value as UnknownRecord;
}

function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "expected an array");
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail(path, "expected a string");
  }
  return value;
}

function expectIdentifier(value: unknown, path: string): string {
  const identifier = expectString(value, path);
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    fail(path, "expected a nonempty lowercase kebab-case identifier");
  }
  return identifier;
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(path, "expected a finite integer");
  }
  return value;
}

function expectPositiveInteger(value: unknown, path: string): number {
  const integer = expectInteger(value, path);
  if (integer <= 0) {
    fail(path, "expected an integer greater than zero");
  }
  return integer;
}

function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a finite number");
  }
  return value;
}

function expectPositiveFiniteNumber(value: unknown, path: string): number {
  const number = expectFiniteNumber(value, path);
  if (number <= 0) {
    fail(path, "expected a number greater than zero");
  }
  return number;
}

function assertExactKeys(
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
): void {
  // Rejecting unknown fields catches misspellings instead of silently accepting a
  // profile that looks configured but behaves differently.
  for (const expectedKey of expectedKeys) {
    if (!Object.hasOwn(record, expectedKey)) {
      fail(`${path}.${expectedKey}`, "required field is missing");
    }
  }

  const unexpectedKey = Object.keys(record).find(
    (recordKey) => !expectedKeys.includes(recordKey),
  );
  if (unexpectedKey !== undefined) {
    fail(`${path}.${unexpectedKey}`, "unexpected field");
  }
}

function readRequired(record: UnknownRecord, key: string, path: string): unknown {
  if (!Object.hasOwn(record, key)) {
    fail(`${path}.${key}`, "required field is missing");
  }
  return record[key];
}

function isPlayback(value: string): value is AnimationPlayback {
  return PLAYBACK_VALUES.some((playback) => playback === value);
}

function frameKey(frame: AtlasFrame): string {
  return `${frame.row},${frame.column}`;
}

function fail(path: string, message: string): never {
  throw new AnimationProfileValidationError(path, message);
}
