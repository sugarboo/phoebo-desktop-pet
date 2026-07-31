import type { AtlasFrame, AtlasGeometry } from "../animation/animation-profile.js";

export interface SourceRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function getFrameSourceRectangle(
  atlas: AtlasGeometry,
  frame: AtlasFrame,
): SourceRectangle {
  assertFrameCoordinate("row", frame.row, atlas.rows);
  assertFrameCoordinate("column", frame.column, atlas.columns);

  const sourceRectangle = {
    // Atlas coordinates use zero-based grid cells. The renderer consumes this
    // integer source rectangle through Canvas's nine-argument drawImage overload.
    x: frame.column * atlas.frameWidth,
    y: frame.row * atlas.frameHeight,
    width: atlas.frameWidth,
    height: atlas.frameHeight,
  };

  if (
    sourceRectangle.x + sourceRectangle.width > atlas.width ||
    sourceRectangle.y + sourceRectangle.height > atlas.height
  ) {
    throw new RangeError("Frame source rectangle exceeds the atlas dimensions");
  }

  return sourceRectangle;
}

function assertFrameCoordinate(name: "row" | "column", value: number, limit: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value >= limit) {
    throw new RangeError(`Frame ${name} must be an integer between 0 and ${limit - 1}`);
  }
}
