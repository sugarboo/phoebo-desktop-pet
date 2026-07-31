import type { AnimationProfile } from "../animation/animation-profile.js";
import {
  BEHAVIOR_PROFILE_SCHEMA_VERSION,
  type BehaviorAction,
  type BehaviorActionTransition,
  type BehaviorCadence,
  type BehaviorProfile,
  type DragMotionBehavior,
  type IdleDelayRange,
} from "./behavior-profile.js";

type UnknownRecord = Record<string, unknown>;

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "id",
  "defaultClipId",
  "idleDelayMs",
  "cadence",
  "dragMotion",
  "actions",
] as const;
const IDLE_DELAY_KEYS = ["minimum", "maximum"] as const;
const CADENCE_KEYS = [
  "avoidImmediateRepeat",
  "settleBeforeActionMs",
  "settleAfterActionMs",
] as const;
const DRAG_MOTION_KEYS = ["leftClipId", "rightClipId", "stopDelayMs"] as const;
const ACTION_KEYS = [
  "clipId",
  "weight",
  "cooldownMs",
  "interruptible",
  "transition",
] as const;
const ACTION_TRANSITION_VALUES: readonly BehaviorActionTransition[] = [
  "settled",
  "direct",
];
const MAXIMUM_SETTLE_DURATION_MS = 500;
const MAXIMUM_DRAG_STOP_DELAY_MS = 500;

export class BehaviorProfileValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "BehaviorProfileValidationError";
    this.path = path;
  }
}

export function parseBehaviorProfile(
  input: unknown,
  animationProfile: AnimationProfile,
): BehaviorProfile {
  // JSON enters the application as `unknown`. Narrowing every field here keeps the
  // scheduler small and gives configuration mistakes an exact, readable JSON path.
  const path = "behaviorProfile";
  const document = expectRecord(input, path);
  assertExactKeys(document, TOP_LEVEL_KEYS, path);

  const schemaVersion = expectInteger(
    readRequired(document, "schemaVersion", path),
    `${path}.schemaVersion`,
  );
  if (schemaVersion !== BEHAVIOR_PROFILE_SCHEMA_VERSION) {
    fail(
      `${path}.schemaVersion`,
      `expected ${BEHAVIOR_PROFILE_SCHEMA_VERSION}, received ${schemaVersion}`,
    );
  }

  const id = expectIdentifier(readRequired(document, "id", path), `${path}.id`);
  const defaultClipId = expectIdentifier(
    readRequired(document, "defaultClipId", path),
    `${path}.defaultClipId`,
  );
  const defaultClip = animationProfile.clips[defaultClipId];
  if (defaultClip === undefined) {
    fail(`${path}.defaultClipId`, `animation clip "${defaultClipId}" does not exist`);
  }
  if (defaultClip.playback === "once") {
    fail(
      `${path}.defaultClipId`,
      "must reference a persistent loop or pose animation clip",
    );
  }

  const idleDelayMs = parseIdleDelay(
    readRequired(document, "idleDelayMs", path),
    `${path}.idleDelayMs`,
  );
  const cadence = parseCadence(
    readRequired(document, "cadence", path),
    `${path}.cadence`,
  );
  const dragMotion = parseDragMotion(
    readRequired(document, "dragMotion", path),
    `${path}.dragMotion`,
    animationProfile,
  );
  const actions = parseActions(
    readRequired(document, "actions", path),
    `${path}.actions`,
    animationProfile,
  );

  return Object.freeze({
    schemaVersion,
    id,
    defaultClipId,
    idleDelayMs,
    cadence,
    dragMotion,
    actions,
  });
}

function parseIdleDelay(input: unknown, path: string): IdleDelayRange {
  const delay = expectRecord(input, path);
  assertExactKeys(delay, IDLE_DELAY_KEYS, path);

  const minimum = expectNonnegativeFiniteNumber(
    readRequired(delay, "minimum", path),
    `${path}.minimum`,
  );
  const maximum = expectNonnegativeFiniteNumber(
    readRequired(delay, "maximum", path),
    `${path}.maximum`,
  );
  if (maximum < minimum) {
    fail(`${path}.maximum`, "must be greater than or equal to minimum");
  }

  return Object.freeze({ minimum, maximum });
}

function parseCadence(input: unknown, path: string): BehaviorCadence {
  const cadence = expectRecord(input, path);
  assertExactKeys(cadence, CADENCE_KEYS, path);

  const avoidImmediateRepeat = expectBoolean(
    readRequired(cadence, "avoidImmediateRepeat", path),
    `${path}.avoidImmediateRepeat`,
  );
  const settleBeforeActionMs = expectSettleDuration(
    readRequired(cadence, "settleBeforeActionMs", path),
    `${path}.settleBeforeActionMs`,
  );
  const settleAfterActionMs = expectSettleDuration(
    readRequired(cadence, "settleAfterActionMs", path),
    `${path}.settleAfterActionMs`,
  );

  return Object.freeze({
    avoidImmediateRepeat,
    settleBeforeActionMs,
    settleAfterActionMs,
  });
}

function parseDragMotion(
  input: unknown,
  path: string,
  animationProfile: AnimationProfile,
): DragMotionBehavior {
  const dragMotion = expectRecord(input, path);
  assertExactKeys(dragMotion, DRAG_MOTION_KEYS, path);

  const leftClipId = parseLoopingClipId(
    readRequired(dragMotion, "leftClipId", path),
    `${path}.leftClipId`,
    animationProfile,
  );
  const rightClipId = parseLoopingClipId(
    readRequired(dragMotion, "rightClipId", path),
    `${path}.rightClipId`,
    animationProfile,
  );
  if (leftClipId === rightClipId) {
    fail(`${path}.rightClipId`, "must differ from leftClipId");
  }

  const stopDelayMs = expectPositiveFiniteNumber(
    readRequired(dragMotion, "stopDelayMs", path),
    `${path}.stopDelayMs`,
  );
  if (stopDelayMs > MAXIMUM_DRAG_STOP_DELAY_MS) {
    fail(
      `${path}.stopDelayMs`,
      `must be no greater than ${MAXIMUM_DRAG_STOP_DELAY_MS}`,
    );
  }

  return Object.freeze({
    leftClipId,
    rightClipId,
    stopDelayMs,
  });
}

function parseActions(
  input: unknown,
  path: string,
  animationProfile: AnimationProfile,
): readonly BehaviorAction[] {
  const actionDocuments = expectArray(input, path);
  if (actionDocuments.length === 0) {
    fail(path, "must contain at least one action");
  }

  const clipIds = new Set<string>();
  const actions = actionDocuments.map((actionDocument, actionIndex) => {
    const actionPath = `${path}[${actionIndex}]`;
    const action = expectRecord(actionDocument, actionPath);
    assertExactKeys(action, ACTION_KEYS, actionPath);

    const clipId = expectIdentifier(
      readRequired(action, "clipId", actionPath),
      `${actionPath}.clipId`,
    );
    if (clipIds.has(clipId)) {
      fail(`${actionPath}.clipId`, `duplicate action clip "${clipId}"`);
    }
    clipIds.add(clipId);

    const animationClip = animationProfile.clips[clipId];
    if (animationClip === undefined) {
      fail(`${actionPath}.clipId`, `animation clip "${clipId}" does not exist`);
    }
    // Random actions must finish by themselves so PetRuntime can reliably return
    // to the default loop before asking the scheduler for another action.
    if (animationClip.playback !== "once") {
      fail(`${actionPath}.clipId`, "must reference a one-shot animation clip");
    }

    const weight = expectPositiveFiniteNumber(
      readRequired(action, "weight", actionPath),
      `${actionPath}.weight`,
    );
    const cooldownMs = expectNonnegativeFiniteNumber(
      readRequired(action, "cooldownMs", actionPath),
      `${actionPath}.cooldownMs`,
    );
    const interruptible = expectBoolean(
      readRequired(action, "interruptible", actionPath),
      `${actionPath}.interruptible`,
    );
    const transitionValue = expectString(
      readRequired(action, "transition", actionPath),
      `${actionPath}.transition`,
    );
    if (!isActionTransition(transitionValue)) {
      fail(
        `${actionPath}.transition`,
        `expected one of ${ACTION_TRANSITION_VALUES.join(", ")}, received "${transitionValue}"`,
      );
    }

    return Object.freeze({
      clipId,
      weight,
      cooldownMs,
      interruptible,
      transition: transitionValue,
    });
  });

  // Individually finite weights can still overflow when added. Catch that once at
  // the configuration boundary instead of allowing weighted choice to become NaN.
  const totalWeight = actions.reduce((total, action) => total + action.weight, 0);
  if (!Number.isFinite(totalWeight)) {
    fail(path, "combined action weight must be finite");
  }

  return Object.freeze(actions);
}

function parseLoopingClipId(
  input: unknown,
  path: string,
  animationProfile: AnimationProfile,
): string {
  const clipId = expectIdentifier(input, path);
  const clip = animationProfile.clips[clipId];
  if (clip === undefined) {
    fail(path, `animation clip "${clipId}" does not exist`);
  }
  if (clip.playback !== "loop") {
    fail(path, "must reference a looping animation clip");
  }
  return clipId;
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

function expectNonnegativeFiniteNumber(value: unknown, path: string): number {
  const number = expectFiniteNumber(value, path);
  if (number < 0) {
    fail(path, "expected a nonnegative number");
  }
  return number;
}

function expectSettleDuration(value: unknown, path: string): number {
  const durationMs = expectNonnegativeFiniteNumber(value, path);
  if (durationMs > MAXIMUM_SETTLE_DURATION_MS) {
    fail(path, `must be no greater than ${MAXIMUM_SETTLE_DURATION_MS}`);
  }
  return durationMs;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "expected a boolean");
  }
  return value;
}

function isActionTransition(value: string): value is BehaviorActionTransition {
  return ACTION_TRANSITION_VALUES.some((transition) => transition === value);
}

function assertExactKeys(
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
): void {
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

function fail(path: string, message: string): never {
  throw new BehaviorProfileValidationError(path, message);
}
