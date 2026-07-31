import type { AtlasGeometry } from "../animation/animation-profile.js";
import type { PetAssetSource } from "../pet/pet-skin.js";

export type AtlasLoadErrorCategory = "source" | "decode" | "dimensions";

export interface DecodedAtlas {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export class AtlasLoadError extends Error {
  readonly category: AtlasLoadErrorCategory;

  constructor(category: AtlasLoadErrorCategory, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AtlasLoadError";
    this.category = category;
  }
}

export class AtlasLoader {
  async load(source: PetAssetSource, expected: AtlasGeometry): Promise<DecodedAtlas> {
    if (source.kind !== "bundled" || source.url.length === 0) {
      throw new AtlasLoadError("source", "A nonempty bundled atlas URL is required");
    }

    const image = new Image();
    // `decode()` waits for WebView2 to fully decode the local WebP. Merely waiting
    // for a URL assignment is not enough to guarantee natural dimensions or pixels.
    image.decoding = "async";
    image.src = source.url;

    try {
      await image.decode();
    } catch (error: unknown) {
      throw new AtlasLoadError("decode", "The bundled pet atlas could not be decoded", {
        cause: error,
      });
    }

    // Validate before returning the handle so an incompatible atlas can never
    // become the renderer's active image.
    validateDecodedAtlasDimensions(image.naturalWidth, image.naturalHeight, expected);

    return Object.freeze({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  }
}

export function validateDecodedAtlasDimensions(
  width: number,
  height: number,
  expected: Pick<AtlasGeometry, "width" | "height">,
): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width !== expected.width ||
    height !== expected.height
  ) {
    throw new AtlasLoadError(
      "dimensions",
      `Decoded atlas dimensions ${width} × ${height} do not match ` +
        `${expected.width} × ${expected.height}`,
    );
  }
}
