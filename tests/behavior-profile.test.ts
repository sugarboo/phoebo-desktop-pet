import animationProfileDocument from "../src/config/animation-profiles/codex-v2.animations.json" with {
  type: "json",
};
import behaviorProfileDocument from "../src/config/behaviors/default.behavior.json" with {
  type: "json",
};
import { parseAnimationProfile } from "../src/animation/profile-parser.js";
import { parseBehaviorProfile } from "../src/behavior/profile-parser.js";
import {
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from "./test-harness.js";

const animationProfile = parseAnimationProfile(animationProfileDocument as unknown);

test("parses the default behavior profile and keeps tuning outside executable code", () => {
  const profile = parseBehaviorProfile(
    behaviorProfileDocument as unknown,
    animationProfile,
  );

  assertEqual(profile.schemaVersion, 2);
  assertEqual(profile.id, "default");
  assertEqual(profile.defaultClipId, "idle");
  assertDeepEqual(profile.idleDelayMs, { minimum: 60000, maximum: 120000 });
  assertDeepEqual(profile.cadence, {
    avoidImmediateRepeat: true,
    settleBeforeActionMs: 120,
    settleAfterActionMs: 180,
  });
  assertDeepEqual(
    profile.actions.map((action) => [
      action.clipId,
      action.weight,
      action.cooldownMs,
      action.interruptible,
    ]),
    [
      ["wave", 18, 12000, false],
      ["jump", 12, 15000, false],
      ["waiting", 30, 6000, true],
      ["inspect", 20, 9000, true],
    ],
  );
});

test("rejects invalid behavior timing and weights with exact field paths", () => {
  const reversedDelay = structuredClone(behaviorProfileDocument);
  reversedDelay.idleDelayMs.minimum = 120001;
  assertThrows(
    () => parseBehaviorProfile(reversedDelay as unknown, animationProfile),
    "behaviorProfile.idleDelayMs.maximum",
  );

  const zeroWeight = structuredClone(behaviorProfileDocument);
  zeroWeight.actions[1]!.weight = 0;
  assertThrows(
    () => parseBehaviorProfile(zeroWeight as unknown, animationProfile),
    "behaviorProfile.actions[1].weight",
  );

  const negativeCooldown = structuredClone(behaviorProfileDocument);
  negativeCooldown.actions[2]!.cooldownMs = -1;
  assertThrows(
    () => parseBehaviorProfile(negativeCooldown as unknown, animationProfile),
    "behaviorProfile.actions[2].cooldownMs",
  );

  const negativeSettle = structuredClone(behaviorProfileDocument);
  negativeSettle.cadence.settleBeforeActionMs = -1;
  assertThrows(
    () => parseBehaviorProfile(negativeSettle as unknown, animationProfile),
    "behaviorProfile.cadence.settleBeforeActionMs",
  );

  const nonFiniteSettle = structuredClone(behaviorProfileDocument);
  nonFiniteSettle.cadence.settleAfterActionMs = Number.POSITIVE_INFINITY;
  assertThrows(
    () => parseBehaviorProfile(nonFiniteSettle as unknown, animationProfile),
    "behaviorProfile.cadence.settleAfterActionMs",
  );

  const excessiveSettle = structuredClone(behaviorProfileDocument);
  excessiveSettle.cadence.settleAfterActionMs = 501;
  assertThrows(
    () => parseBehaviorProfile(excessiveSettle as unknown, animationProfile),
    "must be no greater than 500",
  );

  const unknownCadenceField = structuredClone(
    behaviorProfileDocument,
  ) as unknown as {
    cadence: Record<string, unknown>;
  };
  unknownCadenceField.cadence.crossfadeMs = 100;
  assertThrows(
    () => parseBehaviorProfile(unknownCadenceField, animationProfile),
    "behaviorProfile.cadence.crossfadeMs",
  );
});

test("rejects missing, looping, and duplicate action clip references", () => {
  const missingClip = structuredClone(behaviorProfileDocument);
  missingClip.actions[0]!.clipId = "missing";
  assertThrows(
    () => parseBehaviorProfile(missingClip as unknown, animationProfile),
    'animation clip "missing" does not exist',
  );

  const loopingAction = structuredClone(behaviorProfileDocument);
  loopingAction.actions[0]!.clipId = "idle";
  assertThrows(
    () => parseBehaviorProfile(loopingAction as unknown, animationProfile),
    "must reference a one-shot animation clip",
  );

  const duplicateAction = structuredClone(behaviorProfileDocument);
  duplicateAction.actions[1]!.clipId = duplicateAction.actions[0]!.clipId;
  assertThrows(
    () => parseBehaviorProfile(duplicateAction as unknown, animationProfile),
    'duplicate action clip "wave"',
  );

  const nonLoopingDefault = structuredClone(behaviorProfileDocument);
  nonLoopingDefault.defaultClipId = "wave";
  assertThrows(
    () => parseBehaviorProfile(nonLoopingDefault as unknown, animationProfile),
    "must reference a looping animation clip",
  );
});
