// Extend Expo's Metro config (required by expo-router / SDK 51).
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @supabase/supabase-js does an optional dynamic import("@opentelemetry/api")
// for telemetry it doesn't need. Metro tries to resolve it at build time and
// fails (it isn't installed), breaking BOTH the web export and native builds.
// Stub the whole @opentelemetry/* namespace to an empty module — the SDK's
// import has a `.catch(() => null)`, so disabling telemetry just works.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@opentelemetry/api" || moduleName.startsWith("@opentelemetry/")) {
    return { type: "empty" };
  }
  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
