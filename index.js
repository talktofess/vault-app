// Polyfill crypto.getRandomValues for @noble before anything else loads (native
// only; rng.web.ts is a no-op since browsers ship a CSPRNG), then hand off to
// expo-router's entry.
import "./src/platform/rng";
// URL + structuredClone polyfills so @supabase/supabase-js works on Hermes.
import "react-native-url-polyfill/auto";
import "./src/platform/polyfills";
import "expo-router/entry";
