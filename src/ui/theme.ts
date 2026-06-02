// Design tokens. A refined, premium dark palette with an indigo→violet accent.
// All keys the rest of the app already uses are preserved; new ones are additive.
export const theme = {
  bg: "#1b150e", // warm dark brown (lighter than before)
  bgElevated: "#241c12", // headers / raised surfaces / sidebar
  surface: "#2c2217", // cards, inputs
  surfaceAlt: "#3a2d1d", // pressed / selected
  border: "#473722", // hairline separators
  text: "#f8f3ea",
  muted: "#bcae97",
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
