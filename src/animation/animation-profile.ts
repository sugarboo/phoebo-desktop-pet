export const ANIMATION_PROFILE_SCHEMA_VERSION = 1;
export const CODEX_V2_PROFILE_ID = "codex-v2";

export const CODEX_V2_ATLAS_CONTRACT = Object.freeze({
  width: 1536,
  height: 2288,
  columns: 8,
  rows: 11,
  frameWidth: 192,
  frameHeight: 208,
});

export const CODEX_V2_CLIP_IDS = [
  "idle",
  "walk-right",
  "walk-left",
  "wave",
  "jump",
  "disappointed",
  "waiting",
  "scamper",
  "inspect",
] as const;

export type AnimationPlayback = "loop" | "once" | "pose";

export interface AtlasFrame {
  readonly row: number;
  readonly column: number;
}

export interface TimedAnimationFrame extends AtlasFrame {
  readonly durationMs: number;
}

export interface AtlasGeometry {
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly neutralFrame: AtlasFrame;
}

export interface AnimationClip {
  readonly id: string;
  readonly playback: AnimationPlayback;
  readonly frames: readonly TimedAnimationFrame[];
}

export interface DirectionProfile {
  readonly startAngleDegrees: number;
  readonly stepDegrees: number;
  readonly frames: readonly AtlasFrame[];
}

export interface AnimationProfile {
  readonly schemaVersion: number;
  readonly id: string;
  readonly atlas: AtlasGeometry;
  readonly clips: Readonly<Record<string, AnimationClip>>;
  readonly directions: DirectionProfile;
}
