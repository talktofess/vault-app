// Design tokens — a light "cream" theme with warm brown accents. All keys the
// rest of the app already uses are preserved; new ones are additive. (Media
// viewers keep their own black backdrop regardless of this.)
export const theme = {
  bg: "#f7f1e3", // light cream background
  bgElevated: "#fbf6ea", // headers / raised surfaces / sidebar
  surface: "#fdf9f0", // cards, inputs
  surfaceAlt: "#efe2c8", // pressed / selected
  border: "#e6d8ba", // hairline separators
  text: "#332a1c", // dark brown text
  muted: "#938468", // muted brown
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
