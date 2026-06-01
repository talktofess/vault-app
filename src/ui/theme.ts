// Design tokens. A refined, premium dark palette with an indigo→violet accent.
// All keys the rest of the app already uses are preserved; new ones are additive.
export const theme = {
  bg: "#0a0b0f", // app background (deep, near-black with a cool tint)
  bgElevated: "#10121a", // headers / raised surfaces
  surface: "#151823", // cards, inputs
  surfaceAlt: "#1d2130", // pressed / selected
  border: "#262b3b", // hairline separators
  text: "#f4f6fb",
  muted: "#9298ad",
  accent: "#7c9dff", // primary
  accent2: "#a98bff", // gradient end / secondary
  accentText: "#0a0b0f", // text on the accent gradient
  danger: "#ff6b6b",
  good: "#46d39a",
  warn: "#ffc861",
  radiusSm: 12,
  radius: 16,
  radiusLg: 24,
  // accent gradient stops (used by Button + headers)
  gradient: ["#7c9dff", "#a98bff"] as [string, string],
};
