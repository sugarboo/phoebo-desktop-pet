import type { AtlasFrame, AtlasGeometry } from "../animation/animation-profile.js";
import type { DecodedAtlas } from "./atlas-loader.js";
import {
  getFrameSourceRectangle,
  type SourceRectangle,
} from "./frame-coordinate.js";
import { normalizeDevicePixelRatio } from "./device-pixel-ratio-monitor.js";

export interface CanvasMetrics {
  readonly pixelRatio: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export type PixelRatioSource = () => number;

const readWindowPixelRatio: PixelRatioSource = () => window.devicePixelRatio;

export class CanvasPetRenderer {
  readonly logicalWidth: number;
  readonly logicalHeight: number;

  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly atlasGeometry: AtlasGeometry,
    private readonly pixelRatioSource: PixelRatioSource = readWindowPixelRatio,
  ) {
    this.logicalWidth = atlasGeometry.frameWidth;
    this.logicalHeight = atlasGeometry.frameHeight;

    // Alpha must remain enabled because the Tauri window itself is transparent;
    // transparent Canvas pixels reveal the desktop behind Phoebo.
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) {
      throw new Error("Canvas 2D is unavailable");
    }
    this.context = context;
  }

  renderFrame(atlas: DecodedAtlas, frame: AtlasFrame): void {
    if (atlas.width !== this.atlasGeometry.width || atlas.height !== this.atlasGeometry.height) {
      throw new RangeError("Decoded atlas dimensions no longer match the animation profile");
    }

    const source = getFrameSourceRectangle(this.atlasGeometry, frame);
    const metrics = calculateCanvasMetrics(
      this.logicalWidth,
      this.logicalHeight,
      this.pixelRatioSource(),
    );

    this.resizeBackingStore(metrics);

    // Canvas width/height are physical backing pixels, whereas its CSS size and
    // Tauri window size stay in logical pixels. Scaling the transform joins the two.
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(metrics.scaleX, 0, 0, metrics.scaleY, 0, 0);
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";
    this.context.drawImage(
      // The first rectangle crops one cell from the full atlas; the second draws it
      // into the full logical pet window without extracting intermediate images.
      atlas.source,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      this.logicalWidth,
      this.logicalHeight,
    );
    this.protectFrameEdges(atlas.source, source);
  }

  private resizeBackingStore(metrics: CanvasMetrics): void {
    if (
      this.canvas.width !== metrics.backingWidth ||
      this.canvas.height !== metrics.backingHeight
    ) {
      this.canvas.width = metrics.backingWidth;
      this.canvas.height = metrics.backingHeight;
      // Assigning width or height resets Canvas drawing state, which is why
      // renderFrame reapplies transforms and smoothing after this method.
    }

    const logicalWidth = `${this.logicalWidth}px`;
    const logicalHeight = `${this.logicalHeight}px`;
    if (this.canvas.style.width !== logicalWidth) {
      this.canvas.style.width = logicalWidth;
    }
    if (this.canvas.style.height !== logicalHeight) {
      this.canvas.style.height = logicalHeight;
    }
  }

  private protectFrameEdges(sourceImage: CanvasImageSource, source: SourceRectangle): void {
    // Chromium can sample a neighboring atlas cell when a source rectangle is scaled at a
    // fractional DPR. Redrawing a cleared two-pixel perimeter without smoothing preserves the
    // current cell's alpha and color without allocating a second Canvas or extracted frame.
    const edgeSize = 2;
    const sourceRight = source.x + source.width - edgeSize;
    const sourceBottom = source.y + source.height - edgeSize;
    const destinationRight = this.logicalWidth - edgeSize;
    const destinationBottom = this.logicalHeight - edgeSize;

    this.context.clearRect(0, 0, edgeSize, this.logicalHeight);
    this.context.clearRect(destinationRight, 0, edgeSize, this.logicalHeight);
    this.context.clearRect(0, 0, this.logicalWidth, edgeSize);
    this.context.clearRect(0, destinationBottom, this.logicalWidth, edgeSize);
    this.context.imageSmoothingEnabled = false;
    this.context.drawImage(
      sourceImage,
      source.x,
      source.y,
      edgeSize,
      source.height,
      0,
      0,
      edgeSize,
      this.logicalHeight,
    );
    this.context.drawImage(
      sourceImage,
      sourceRight,
      source.y,
      edgeSize,
      source.height,
      destinationRight,
      0,
      edgeSize,
      this.logicalHeight,
    );
    this.context.drawImage(
      sourceImage,
      source.x,
      source.y,
      source.width,
      edgeSize,
      0,
      0,
      this.logicalWidth,
      edgeSize,
    );
    this.context.drawImage(
      sourceImage,
      source.x,
      sourceBottom,
      source.width,
      edgeSize,
      0,
      destinationBottom,
      this.logicalWidth,
      edgeSize,
    );
  }
}

export function calculateCanvasMetrics(
  logicalWidth: number,
  logicalHeight: number,
  requestedPixelRatio: number,
): CanvasMetrics {
  assertPositiveInteger("logicalWidth", logicalWidth);
  assertPositiveInteger("logicalHeight", logicalHeight);

  const pixelRatio = normalizeDevicePixelRatio(requestedPixelRatio);
  // Backing dimensions must be integers. Deriving the actual scale from rounded
  // dimensions keeps the destination aligned exactly with the allocated pixels.
  const backingWidth = Math.max(1, Math.round(logicalWidth * pixelRatio));
  const backingHeight = Math.max(1, Math.round(logicalHeight * pixelRatio));

  return Object.freeze({
    pixelRatio,
    backingWidth,
    backingHeight,
    scaleX: backingWidth / logicalWidth,
    scaleY: backingHeight / logicalHeight,
  });
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
