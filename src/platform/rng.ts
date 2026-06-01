// Native: polyfill crypto.getRandomValues for @noble. On web this file is
// shadowed by rng.web.ts (the browser already provides a secure CSPRNG).
import "react-native-get-random-values";
