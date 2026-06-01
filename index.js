// Polyfill crypto.getRandomValues for @noble before anything else loads (native
// only; rng.web.ts is a no-op since browsers ship a CSPRNG), then hand off to
// expo-router's entry.
import "./src/platform/rng";
import "expo-router/entry";
