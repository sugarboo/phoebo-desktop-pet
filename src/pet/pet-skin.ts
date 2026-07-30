export interface BundledPetAssetSource {
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
