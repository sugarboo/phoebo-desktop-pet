import animationProfileDocument from "../src/config/animation-profiles/codex-v2.animations.json" with {
  type: "json",
};
import { parseAnimationProfile } from "../src/animation/profile-parser.js";
import { validateDecodedAtlasDimensions } from "../src/rendering/atlas-loader.js";
import {
  calculateCanvasMetrics,
  type CanvasMetrics,
} from "../src/rendering/canvas-pet-renderer.js";
import {
  observeDevicePixelRatio,
  type DevicePixelRatioEnvironment,
} from "../src/rendering/device-pixel-ratio-monitor.js";
import { getFrameSourceRectangle } from "../src/rendering/frame-coordinate.js";
import {
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from "./test-harness.js";

const animationProfile = parseAnimationProfile(animationProfileDocument as unknown);

test("calculates representative codex-v2 source rectangles", () => {
  assertDeepEqual(
    getFrameSourceRectangle(animationProfile.atlas, { row: 0, column: 0 }),
    { x: 0, y: 0, width: 192, height: 208 },
  );
  assertDeepEqual(
    getFrameSourceRectangle(animationProfile.atlas, { row: 0, column: 6 }),
    { x: 1152, y: 0, width: 192, height: 208 },
  );
  assertDeepEqual(
    getFrameSourceRectangle(animationProfile.atlas, { row: 9, column: 0 }),
    { x: 0, y: 1872, width: 192, height: 208 },
  );
  assertDeepEqual(
    getFrameSourceRectangle(animationProfile.atlas, { row: 10, column: 7 }),
    { x: 1344, y: 2080, width: 192, height: 208 },
  );
});

test("rejects invalid source frame coordinates", () => {
  for (const frame of [
    { row: -1, column: 0 },
    { row: 11, column: 0 },
    { row: 0, column: -1 },
    { row: 0, column: 8 },
    { row: 0.5, column: 0 },
  ]) {
    assertThrows(
      () => getFrameSourceRectangle(animationProfile.atlas, frame),
      "must be an integer between",
    );
  }
});

test("calculates the four required device-pixel-ratio backing stores", () => {
  const expected = [
    { ratio: 1, width: 192, height: 208 },
    { ratio: 1.25, width: 240, height: 260 },
    { ratio: 1.5, width: 288, height: 312 },
    { ratio: 2, width: 384, height: 416 },
  ] as const;

  for (const entry of expected) {
    const metrics = calculateCanvasMetrics(192, 208, entry.ratio);
    assertMetrics(metrics, entry.ratio, entry.width, entry.height);
  }
});

test("falls back to DPR 1 for invalid ratios", () => {
  for (const invalidRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertMetrics(calculateCanvasMetrics(192, 208, invalidRatio), 1, 192, 208);
  }
});

test("rejects decoded atlases with either incorrect dimension", () => {
  validateDecodedAtlasDimensions(1536, 2288, animationProfile.atlas);
  assertThrows(
    () => validateDecodedAtlasDimensions(1535, 2288, animationProfile.atlas),
    "1536 × 2288",
  );
  assertThrows(
    () => validateDecodedAtlasDimensions(1536, 2287, animationProfile.atlas),
    "1536 × 2288",
  );
});

test("redraws once per changed DPR and releases every listener", () => {
  let currentPixelRatio = 1;
  let resolutionListener = (): void => {};
  let resizeListener = (): void => {};
  let resolutionUnsubscribeCount = 0;
  let resizeUnsubscribeCount = 0;
  const subscribedPixelRatios: number[] = [];
  const observedPixelRatios: number[] = [];

  const environment: DevicePixelRatioEnvironment = {
    readPixelRatio: () => currentPixelRatio,
    subscribeToResolution: (pixelRatio, listener) => {
      subscribedPixelRatios.push(pixelRatio);
      resolutionListener = listener;
      return () => {
        resolutionUnsubscribeCount += 1;
      };
    },
    subscribeToResize: (listener) => {
      resizeListener = listener;
      return () => {
        resizeUnsubscribeCount += 1;
      };
    },
  };

  const stopObserving = observeDevicePixelRatio(
    (pixelRatio) => {
      observedPixelRatios.push(pixelRatio);
    },
    environment,
  );

  resizeListener();
  currentPixelRatio = 1.5;
  resolutionListener();
  resizeListener();
  currentPixelRatio = 2;
  resizeListener();
  stopObserving();
  resolutionListener();
  resizeListener();
  stopObserving();

  assertDeepEqual(observedPixelRatios, [1.5, 2]);
  assertDeepEqual(subscribedPixelRatios, [1, 1.5, 2]);
  assertEqual(resolutionUnsubscribeCount, 3);
  assertEqual(resizeUnsubscribeCount, 1);
});

function assertMetrics(
  metrics: CanvasMetrics,
  pixelRatio: number,
  backingWidth: number,
  backingHeight: number,
): void {
  assertEqual(metrics.pixelRatio, pixelRatio);
  assertEqual(metrics.backingWidth, backingWidth);
  assertEqual(metrics.backingHeight, backingHeight);
  assertEqual(metrics.scaleX, backingWidth / 192);
  assertEqual(metrics.scaleY, backingHeight / 208);
}
