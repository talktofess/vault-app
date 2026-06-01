import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "./theme";

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "danger";
  loading?: boolean;
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  const isOutline = variant === "outline";
  const fg = isOutline ? theme.text : isPrimary ? theme.accentText : "#fff";
  const inner = loading ? (
    <ActivityIndicator color={fg} />
  ) : (
    <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btnWrap,
        isPrimary && styles.btnGlow,
        { opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
    >
      {isPrimary ? (
        <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btn}>
          {inner}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.btn,
            variant === "danger" && { backgroundColor: theme.danger },
            isOutline && { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface },
          ]}
        >
          {inner}
        </View>
      )}
    </Pressable>
  );
}

export function Field({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  multiline,
  autoFocus,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.muted}
      secureTextEntry={secureTextEntry}
      multiline={multiline}
      autoFocus={autoFocus}
      autoCapitalize="none"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.input,
        focused && styles.inputFocused,
        multiline && { height: 160, textAlignVertical: "top" },
      ]}
    />
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

/** A rounded, hairline-bordered surface for grouping content. */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: 20, gap: 14 },
  title: { color: theme.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginBottom: 2 },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 21 },
  btnWrap: { borderRadius: theme.radius, overflow: "hidden" },
  btnGlow: {
    shadowColor: theme.accent,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  btn: {
    height: 52,
    borderRadius: theme.radius,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    flexDirection: "row",
  },
  btnText: { fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    color: theme.text,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
  },
  inputFocused: { borderColor: theme.accent, backgroundColor: theme.surfaceAlt },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
  },
});
