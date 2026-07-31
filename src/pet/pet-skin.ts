export interface BundledPetAssetSource {
  // The discriminant leaves a clean seam for a future validated external source
  // without granting filesystem access in the initial application.
  readonly kind: "bundled";
  readonly url: string;
}

export type PetAssetSource = BundledPetAssetSource;

export interface PetSkin {
  readonly id: string;
  readonly displayName: string;
  readonly animationProfileId: string;
  readonly assetSource: PetAssetSource;
}
