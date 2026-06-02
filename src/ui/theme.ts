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
  accent: "#c79a6b", // primary — caramel brown
  accent2: "#9c6b43", // gradient end / secondary — deeper brown
  accentText: "#1a120b", // text on the accent gradient
  danger: "#e07a6b",
  good: "#7bbf8a",
  warn: "#e0b066",
  radiusSm: 12,
  radius: 16,
  radiusLg: 22,
  // accent gradient stops (used by Button + sidebar highlight)
  gradient: ["#cda06f", "#9c6b43"] as [string, string],
};
