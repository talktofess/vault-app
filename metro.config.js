// Extend Expo's Metro config (required by expo-router / SDK 51).
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
