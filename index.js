// Polyfill crypto.getRandomValues for @noble before anything else loads, then
// hand off to expo-router's entry.
import "react-native-get-random-values";
import "expo-router/entry";
