import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
  const bg =
    variant === "primary" ? theme.accent : variant === "danger" ? theme.danger : "transparent";
  const fg = variant === "outline" ? theme.text : "#0e0f13";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "outline" && { borderWidth: 1, borderColor: theme.border },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
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
      style={[styles.input, multiline && { height: 160, textAlignVertical: "top" }]}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: 20, gap: 14 },
  title: { color: theme.text, fontSize: 26, fontWeight: "700", marginBottom: 4 },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  btn: {
    height: 50,
    borderRadius: theme.radius,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  btnText: { fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    color: theme.text,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
  },
});
