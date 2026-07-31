import animationProfileDocument from "../config/animation-profiles/codex-v2.animations.json";
import behaviorProfileDocument from "../config/behaviors/default.behavior.json";
import { parseAnimationProfile } from "../animation/profile-parser.js";
import type { BehaviorProfile } from "../behavior/behavior-profile.js";
import { parseBehaviorProfile } from "../behavior/profile-parser.js";
import { DEFAULT_PET_SKIN } from "../pet/bundled-pet.js";
import type { PetSkin } from "../pet/pet-skin.js";
import { AtlasLoader, type DecodedAtlas } from "../rendering/atlas-loader.js";
import type { AnimationProfile } from "../animation/animation-profile.js";

export interface LoadedPetAssets {
  readonly skin: PetSkin;
  readonly animationProfile: AnimationProfile;
  readonly behaviorProfile: BehaviorProfile;
  readonly atlas: DecodedAtlas;
}

export async function loadDefaultPetAssets(
  atlasLoader: AtlasLoader = new AtlasLoader(),
): Promise<LoadedPetAssets> {
  // Composition happens in one place: parse both profiles, verify that the selected
  // skin names the layout, then decode the associated image.
  const animationProfile = parseAnimationProfile(animationProfileDocument as unknown);
  const behaviorProfile = parseBehaviorProfile(
    behaviorProfileDocument as unknown,
    animationProfile,
  );

  if (DEFAULT_PET_SKIN.animationProfileId !== animationProfile.id) {
    throw new Error(
      `Pet skin profile "${DEFAULT_PET_SKIN.animationProfileId}" does not match ` +
        `"${animationProfile.id}"`,
    );
  }

  const atlas = await atlasLoader.load(
    DEFAULT_PET_SKIN.assetSource,
    animationProfile.atlas,
  );

  return Object.freeze({
    skin: DEFAULT_PET_SKIN,
    animationProfile,
    behaviorProfile,
    atlas,
  });
}
