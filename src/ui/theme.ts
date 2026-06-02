// Design tokens. A refined, premium dark palette with an indigo→violet accent.
// All keys the rest of the app already uses are preserved; new ones are additive.
export const theme = {
  bg: "#0c0a08", // warm near-black
  bgElevated: "#15110d", // headers / raised surfaces / sidebar
  surface: "#1b1611", // cards, inputs
  surfaceAlt: "#26201a", // pressed / selected
  border: "#332a22", // hairline separators
  text: "#f6f1ea",
  muted: "#a9a092",
  accent: "#e8cda3", // primary — light wheat/tan
  accent2: "#d4b488", // gradient end / secondary — soft sand
  accentText: "#241a0f", // dark text on the light accent
  danger: "#e58a7c",
  good: "#8fcf9b",
  warn: "#e8c27e",
  radiusSm: 12,
  radius: 16,
  radiusLg: 22,
  // accent gradient stops (used by Button + sidebar highlight)
  gradient: ["#f0dcbd", "#d4b488"] as [string, string],
};
