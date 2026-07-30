import {
  CODEX_V2_CLIP_IDS,
  type AnimationClip,
  type AnimationProfile,
  type AtlasFrame,
  type AtlasGeometry,
} from "../src/animation/animation-profile.js";
import { loadDefaultPetAssets } from "../src/app/load-default-pet.js";
import type { DecodedAtlas } from "../src/rendering/atlas-loader.js";
import { CanvasPetRenderer } from "../src/rendering/canvas-pet-renderer.js";

const EXPECTED_ATLAS_HASH =
  "231C5BE5FB9ED9C1E1F027742FD1500AEEE6018F6ED9C9EAB360ABF34FAAAA70";
const REQUIRED_PIXEL_RATIOS = [1, 1.25, 1.5, 2] as const;
const CONTACT_SHEET_COLUMNS = 6;
const CARD_WIDTH = 208;
const CARD_HEIGHT = 236;
const FRAME_OFFSET_X = 8;
const FRAME_OFFSET_Y = 8;
const CHECKER_SIZE = 12;

interface InspectionCase {
  readonly label: string;
  readonly frame: AtlasFrame;
}

interface SolidColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

interface InspectorReport {
  readonly status: "passed";
  readonly atlasHash: string;
  readonly atlasDimensions: string;
  readonly configuredCases: number;
  readonly uniqueCells: number;
  readonly displayPixelRatio: number;
  readonly syntheticPixelChecks: number;
  readonly transparentRealFrames: number;
  readonly backingStores: readonly string[];
}

const statusElement = requireElement("#status");
const reportElement = requireElement("#report");
const probeCanvas = requireCanvas("#renderer-probe");
const contactSheetCanvas = requireCanvas("#contact-sheet");

void inspectAtlas().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  statusElement.dataset.state = "failed";
  statusElement.textContent = "Atlas inspection failed.";
  reportElement.textContent = message;
  document.documentElement.dataset.inspectionState = "failed";
  console.error(`[atlas-inspector] ${message}`);
});

async function inspectAtlas(): Promise<void> {
  const displayPixelRatio = readDisplayPixelRatio();
  const loadedPet = await loadDefaultPetAssets();
  const cases = buildInspectionCases(loadedPet.animationProfile);
  assertInspectionCases(cases);

  const atlasHash = await hashBundledAtlas(loadedPet.skin.assetSource.url);
  assertEqual(atlasHash, EXPECTED_ATLAS_HASH, "Bundled atlas SHA-256 changed");

  let activePixelRatio = displayPixelRatio;
  const renderer = new CanvasPetRenderer(
    probeCanvas,
    loadedPet.animationProfile.atlas,
    () => activePixelRatio,
  );
  const syntheticAtlas = createSyntheticAtlas(loadedPet.animationProfile.atlas);
  const syntheticPixelChecks = runSyntheticPixelChecks(
    renderer,
    syntheticAtlas,
    loadedPet.animationProfile.atlas,
    cases,
    (pixelRatio) => {
      activePixelRatio = pixelRatio;
    },
  );

  activePixelRatio = displayPixelRatio;
  const transparentRealFrames = drawRealAtlasContactSheet(
    renderer,
    loadedPet.atlas,
    loadedPet.animationProfile.atlas,
    cases,
    displayPixelRatio,
  );

  const report: InspectorReport = Object.freeze({
    status: "passed",
    atlasHash,
    atlasDimensions: `${loadedPet.atlas.width} × ${loadedPet.atlas.height}`,
    configuredCases: cases.length,
    uniqueCells: new Set(cases.map(({ frame }) => frameKey(frame))).size,
    displayPixelRatio,
    syntheticPixelChecks,
    transparentRealFrames,
    backingStores: REQUIRED_PIXEL_RATIOS.map(
      (pixelRatio) =>
        `${pixelRatio}×: ${Math.round(192 * pixelRatio)} × ${Math.round(208 * pixelRatio)}`,
    ),
  });

  statusElement.dataset.state = "passed";
  statusElement.textContent =
    "All structural, crop, alpha-clear, DPR, hash, and real-frame visibility checks passed.";
  reportElement.textContent = JSON.stringify(report, null, 2);
  document.documentElement.dataset.inspectionState = "passed";
}

function buildInspectionCases(profile: AnimationProfile): readonly InspectionCase[] {
  const cases: InspectionCase[] = [
    {
      label: "neutral · r0 c6",
      frame: profile.atlas.neutralFrame,
    },
  ];

  for (const clipId of CODEX_V2_CLIP_IDS) {
    const clip = requireClip(profile.clips, clipId);
    clip.frames.forEach((frame, frameIndex) => {
      cases.push({
        label: `${clipId} ${frameIndex + 1}/${clip.frames.length} · r${frame.row} c${frame.column}`,
        frame,
      });
    });
  }

  profile.directions.frames.forEach((frame, directionIndex) => {
    const angle =
      profile.directions.startAngleDegrees +
      directionIndex * profile.directions.stepDegrees;
    cases.push({
      label: `direction ${angle}° · r${frame.row} c${frame.column}`,
      frame,
    });
  });

  return Object.freeze(cases);
}

function assertInspectionCases(cases: readonly InspectionCase[]): void {
  assertEqual(cases.length, 74, "Expected neutral + 57 timed + 16 direction cases");
  assertEqual(
    new Set(cases.map(({ frame }) => frameKey(frame))).size,
    74,
    "Every configured inspection case must use a unique atlas cell",
  );
}

function runSyntheticPixelChecks(
  renderer: CanvasPetRenderer,
  syntheticAtlas: DecodedAtlas,
  geometry: AtlasGeometry,
  cases: readonly InspectionCase[],
  setPixelRatio: (pixelRatio: number) => void,
): number {
  let checks = 0;

  for (const pixelRatio of REQUIRED_PIXEL_RATIOS) {
    setPixelRatio(pixelRatio);

    cases.forEach(({ label, frame }, caseIndex) => {
      renderer.renderFrame(syntheticAtlas, frame);
      assertCanvasDimensions(probeCanvas, geometry, pixelRatio);
      assertSolidColor(probeCanvas, colorForFrame(frame, geometry), `${pixelRatio}× ${label}`);

      if (caseIndex === 0) {
        requireCanvasContext(probeCanvas).lineWidth = 7;
      } else if (caseIndex === 1) {
        assertEqual(
          requireCanvasContext(probeCanvas).lineWidth,
          7,
          "Unchanged backing dimensions must not reset the Canvas context",
        );
      }

      checks += 1;
    });

    renderer.renderFrame(syntheticAtlas, cases[0]!.frame);
    renderer.renderFrame(syntheticAtlas, { row: 0, column: 7 });
    assertFullyTransparent(probeCanvas, `${pixelRatio}× alpha-clear sentinel`);
    checks += 1;
  }

  return checks;
}

function createSyntheticAtlas(geometry: AtlasGeometry): DecodedAtlas {
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = geometry.width;
  atlasCanvas.height = geometry.height;
  const context = requireCanvasContext(atlasCanvas);

  for (let row = 0; row < geometry.rows; row += 1) {
    for (let column = 0; column < geometry.columns; column += 1) {
      if (row === 0 && column === 7) {
        continue;
      }

      const color = colorForFrame({ row, column }, geometry);
      context.fillStyle = `rgb(${color.red} ${color.green} ${color.blue})`;
      context.fillRect(
        column * geometry.frameWidth,
        row * geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
      );
    }
  }

  return Object.freeze({
    source: atlasCanvas,
    width: atlasCanvas.width,
    height: atlasCanvas.height,
  });
}

function drawRealAtlasContactSheet(
  renderer: CanvasPetRenderer,
  atlas: DecodedAtlas,
  geometry: AtlasGeometry,
  cases: readonly InspectionCase[],
  pixelRatio: number,
): number {
  const rows = Math.ceil(cases.length / CONTACT_SHEET_COLUMNS);
  const logicalWidth = CONTACT_SHEET_COLUMNS * CARD_WIDTH;
  const logicalHeight = rows * CARD_HEIGHT;
  contactSheetCanvas.width = Math.round(logicalWidth * pixelRatio);
  contactSheetCanvas.height = Math.round(logicalHeight * pixelRatio);
  contactSheetCanvas.style.width = `${logicalWidth}px`;
  contactSheetCanvas.style.height = `${logicalHeight}px`;

  const context = requireCanvasContext(contactSheetCanvas);
  context.setTransform(
    contactSheetCanvas.width / logicalWidth,
    0,
    0,
    contactSheetCanvas.height / logicalHeight,
    0,
    0,
  );
  context.fillStyle = "#0b171c";
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.font = "12px Consolas, monospace";
  context.textBaseline = "top";

  let transparentRealFrames = 0;

  cases.forEach(({ label, frame }, caseIndex) => {
    renderer.renderFrame(atlas, frame);
    assertCanvasDimensions(probeCanvas, geometry, pixelRatio);
    assertMixedAlpha(probeCanvas, label);
    transparentRealFrames += 1;

    const cardColumn = caseIndex % CONTACT_SHEET_COLUMNS;
    const cardRow = Math.floor(caseIndex / CONTACT_SHEET_COLUMNS);
    const frameX = cardColumn * CARD_WIDTH + FRAME_OFFSET_X;
    const frameY = cardRow * CARD_HEIGHT + FRAME_OFFSET_Y;

    drawCheckerboard(context, frameX, frameY, geometry.frameWidth, geometry.frameHeight);
    context.drawImage(
      probeCanvas,
      0,
      0,
      probeCanvas.width,
      probeCanvas.height,
      frameX,
      frameY,
      geometry.frameWidth,
      geometry.frameHeight,
    );
    drawRegistrationOverlay(context, frameX, frameY, geometry.frameWidth, geometry.frameHeight);
    context.fillStyle = "#d8edf2";
    context.fillText(label, frameX, frameY + geometry.frameHeight + 5);
  });

  return transparentRealFrames;
}

function drawCheckerboard(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let checkerY = 0; checkerY < height; checkerY += CHECKER_SIZE) {
    for (let checkerX = 0; checkerX < width; checkerX += CHECKER_SIZE) {
      const isLight =
        (Math.floor(checkerX / CHECKER_SIZE) + Math.floor(checkerY / CHECKER_SIZE)) % 2 ===
        0;
      context.fillStyle = isLight ? "#d7dde0" : "#59676d";
      context.fillRect(
        x + checkerX,
        y + checkerY,
        Math.min(CHECKER_SIZE, width - checkerX),
        Math.min(CHECKER_SIZE, height - checkerY),
      );
    }
  }
}

function drawRegistrationOverlay(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.save();
  context.strokeStyle = "rgba(255, 0, 180, 0.45)";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.beginPath();
  context.moveTo(x + width / 2 + 0.5, y);
  context.lineTo(x + width / 2 + 0.5, y + height);
  context.moveTo(x, y + height / 2 + 0.5);
  context.lineTo(x + width, y + height / 2 + 0.5);
  context.stroke();
  context.restore();
}

function assertCanvasDimensions(
  canvas: HTMLCanvasElement,
  geometry: AtlasGeometry,
  pixelRatio: number,
): void {
  assertEqual(
    canvas.width,
    Math.round(geometry.frameWidth * pixelRatio),
    `${pixelRatio}× backing width`,
  );
  assertEqual(
    canvas.height,
    Math.round(geometry.frameHeight * pixelRatio),
    `${pixelRatio}× backing height`,
  );
  assertEqual(canvas.style.width, `${geometry.frameWidth}px`, "Canvas logical width");
  assertEqual(canvas.style.height, `${geometry.frameHeight}px`, "Canvas logical height");

  const bounds = canvas.getBoundingClientRect();
  assertNear(bounds.width, geometry.frameWidth, "Canvas DOM width");
  assertNear(bounds.height, geometry.frameHeight, "Canvas DOM height");
}

function assertSolidColor(
  canvas: HTMLCanvasElement,
  expected: SolidColor,
  label: string,
): void {
  const pixels = requireCanvasContext(canvas).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;

  for (let index = 0; index < pixels.length; index += 4) {
    if (
      Math.abs(pixels[index]! - expected.red) > 1 ||
      Math.abs(pixels[index + 1]! - expected.green) > 1 ||
      Math.abs(pixels[index + 2]! - expected.blue) > 1 ||
      pixels[index + 3] !== 255
    ) {
      throw new Error(
        `${label}: expected rgba(${expected.red}, ${expected.green}, ${expected.blue}, 255), ` +
          `received rgba(${String(pixels[index])}, ${String(pixels[index + 1])}, ` +
          `${String(pixels[index + 2])}, ${String(pixels[index + 3])}) at byte ${index}`,
      );
    }
  }
}

function assertFullyTransparent(canvas: HTMLCanvasElement, label: string): void {
  const pixels = requireCanvasContext(canvas).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;

  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      throw new Error(`${label}: stale alpha remained at byte ${index}`);
    }
  }
}

function assertMixedAlpha(canvas: HTMLCanvasElement, label: string): void {
  const pixels = requireCanvasContext(canvas).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;
  let hasTransparentPixel = false;
  let hasVisiblePixel = false;

  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index];
    hasTransparentPixel ||= alpha === 0;
    hasVisiblePixel ||= alpha !== 0;
    if (hasTransparentPixel && hasVisiblePixel) {
      return;
    }
  }

  throw new Error(`${label}: expected both visible and transparent pixels`);
}

function colorForFrame(frame: AtlasFrame, geometry: AtlasGeometry): SolidColor {
  const cellIndex = frame.row * geometry.columns + frame.column;
  return {
    red: 32 + (cellIndex % 4) * 64,
    green: 32 + (Math.floor(cellIndex / 4) % 4) * 64,
    blue: 32 + (Math.floor(cellIndex / 16) % 6) * 40,
  };
}

async function hashBundledAtlas(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not read the bundled atlas for hashing: HTTP ${response.status}`);
  }

  const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function readDisplayPixelRatio(): number {
  const rawPixelRatio = new URL(window.location.href).searchParams.get("dpr") ?? "1";
  const pixelRatio = Number(rawPixelRatio);
  if (!REQUIRED_PIXEL_RATIOS.some((required) => required === pixelRatio)) {
    throw new Error(
      `The dpr query parameter must be one of ${REQUIRED_PIXEL_RATIOS.join(", ")}`,
    );
  }
  return pixelRatio;
}

function requireClip(
  clips: Readonly<Record<string, AnimationClip>>,
  clipId: string,
): AnimationClip {
  const clip = clips[clipId];
  if (clip === undefined) {
    throw new Error(`Required clip "${clipId}" was not parsed`);
  }
  return clip;
}

function requireCanvas(selector: string): HTMLCanvasElement {
  const canvas = document.querySelector(selector);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`Required canvas ${selector} was not found`);
  }
  return canvas;
}

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Required element ${selector} was not found`);
  }
  return element;
}

function requireCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (context === null) {
    throw new Error("Canvas 2D is unavailable");
  }
  return context;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertNear(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function frameKey(frame: AtlasFrame): string {
  return `${frame.row},${frame.column}`;
}
