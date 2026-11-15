import type { Background, Model, PhotoOptions } from "./types";

/** Used only when the real catalog cannot be read (for example locally). */
export const SANDBOX_MODELS: Model[] = [
  {
    id: "sbx_model_ana",
    name: "Ana",
    source: "modelfy",
    ready: true,
    age: 27,
    photoUrl: null,
  },
  {
    id: "sbx_model_leo",
    name: "Leo",
    source: "modelfy",
    ready: true,
    age: 31,
    photoUrl: null,
  },
];

export const SANDBOX_BACKGROUNDS: Background[] = [
  {
    id: "sbx_set_terrace",
    name: "Sunny terrace",
    source: "gallery",
    description: "A terrace with plants in warm afternoon light",
    ready: true,
    photoUrl: null,
  },
];

export const SANDBOX_OPTIONS: PhotoOptions = {
  aspectRatios: ["1:1", "4:5", "3:4", "9:16", "16:9"],
  photosPerProduct: { min: 1, max: 8, default: 4 },
  shotTypes: {
    withModel: ["close-up", "medium-shot", "full-body", "wide-shot"],
    withoutModel: [
      "detail",
      "flat-lay",
      "still-life",
      "hanger",
      "ghost-mannequin",
    ],
  },
  resolutions: null,
  qualities: null,
  defaults: { resolution: null, quality: null },
  outfitStyles: [
    "CASUAL",
    "ELEGANT",
    "SPORTY",
    "BUSINESS",
    "STREETWEAR",
    "SUMMER",
    "COZY",
  ],
  maxModels: 3,
};

const SAMPLE_COUNT = 4;

export function samplePhotoUrl(publicUrl: string, index: number): string {
  return `${publicUrl}/sandbox/photos/${index % SAMPLE_COUNT}.svg`;
}

/** A sample photo: a labelled placeholder so nobody mistakes it for a real one. */
export function samplePhotoSvg(index: number): string {
  const hues = [24, 200, 140, 320];
  const hue = hues[index % SAMPLE_COUNT] ?? 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><rect width="800" height="1000" fill="hsl(${hue} 30% 22%)"/><text x="400" y="480" font-family="system-ui,sans-serif" font-size="72" fill="#fff" text-anchor="middle">SANDBOX</text><text x="400" y="560" font-family="system-ui,sans-serif" font-size="32" fill="#ddd" text-anchor="middle">Modelfy sample photo ${index + 1}</text></svg>`;
}
