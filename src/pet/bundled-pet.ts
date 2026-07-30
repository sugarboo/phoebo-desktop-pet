import phoeboAtlasUrl from "../assets/pets/phoebo/spritesheet.webp?url";
import type { PetSkin } from "./pet-skin.js";

export const DEFAULT_PET_ID = "phoebo";

export const DEFAULT_PET_SKIN: PetSkin = Object.freeze({
  id: DEFAULT_PET_ID,
  displayName: "Phoebo",
  animationProfileId: "codex-v2",
  assetSource: Object.freeze({
    kind: "bundled",
    url: phoeboAtlasUrl,
  }),
});
