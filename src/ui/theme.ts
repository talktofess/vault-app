// Design tokens — a light "cream" theme with warm brown accents. All keys the
// rest of the app already uses are preserved; new ones are additive. (Media
// viewers keep their own black backdrop regardless of this.)
export const theme = {
  bg: "#efe6d2", // cream background
  bgElevated: "#f4ecda", // headers / raised surfaces / sidebar
  surface: "#f8f2e6", // cards, inputs
  surfaceAlt: "#e7d9bd", // pressed / selected
  border: "#dccba6", // hairline separators
  text: "#2c2418", // dark brown text
  muted: "#8a7c62", // muted brown
  accent: "#a9784f", // primary — rich brown
  accent2: "#caa06a", // gradient end / secondary
  accentText: "#fdf7ec", // light text on the brown accent
  danger: "#bf5640",
  good: "#4f9a5f",
  warn: "#b07f2e",
  radiusSm: 12,
  radius: 16,
  radiusLg: 22,
  // accent gradient stops (used by Button + sidebar highlight)
  gradient: ["#c79a63", "#a9784f"] as [string, string],
};
