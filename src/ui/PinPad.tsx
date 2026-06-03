import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";

export const PIN_LENGTH = 4;

// A quiet "type your code" entry: just the dots + an invisible field that
// captures typed digits (a real keyboard on web/desktop, the OS number pad on a
// phone). No on-screen calculator grid — used for the unlock screen.
export function PinDots({
  pin,
  onChange,
  disabled,
  onBiometric,
}: {
  pin: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  onBiometric?: () => void;
}) {
  const input = useRef<TextInput>(null);
  const focus = () => input.current?.focus();
  return (
    <Pressable onPress={focus} testID="pin-type-area" style={{ alignItems: "center", gap: 22 }}>
      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dotLg, i < pin.length && styles.dotFilled]} />
        ))}
      </View>
      <TextInput
        ref={input}
        testID="pin-type-input"
        value={pin}
        onChangeText={(t) => !disabled && onChange(t.replace(/\D/g, "").slice(0, PIN_LENGTH))}
        keyboardType="number-pad"
        secureTextEntry
        autoFocus
        editable={!disabled}
        maxLength={PIN_LENGTH}
        // visually hidden, but still focusable + typeable on every platform
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      <Text style={{ color: theme.muted, fontSize: 13 }}>type your code</Text>
      {onBiometric && (
        <Pressable onPress={onBiometric} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
          <Ionicons name="finger-print" size={20} color={theme.accent} />
          <Text style={{ color: theme.accent, fontSize: 14, fontWeight: "600" }}>Use biometrics</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

// A self-contained numeric keypad. We deliberately do NOT use a system TextInput
// here: the OS keyboard (autofill, predictive text, smart punctuation, trailing
// spaces) was the most likely cause of "I set it but can't log back in", because
// the unlock string has to match byte-for-byte. Driving the PIN from our own
// keypad means what you tap is exactly what gets hashed — nothing in between.
export function PinPad({
  pin,
  onChange,
  disabled,
  onBiometric,
}: {
  pin: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  onBiometric?: () => void;
}) {
  function press(d: string) {
    if (disabled) return;
    if (pin.length >= PIN_LENGTH) return;
    onChange(pin + d);
  }
  function backspace() {
    if (disabled) return;
    onChange(pin.slice(0, -1));
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < pin.length && styles.dotFilled]}
          />
        ))}
      </View>

      <View style={styles.grid}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} label={d} onPress={() => press(d)} disabled={disabled} />
        ))}
        {/* bottom row: biometric (optional) · 0 · backspace */}
        {onBiometric ? (
          <Key icon="finger-print" onPress={onBiometric} disabled={disabled} />
        ) : (
          <View style={styles.key} />
        )}
        <Key label="0" onPress={() => press("0")} disabled={disabled} />
        <Key icon="backspace-outline" onPress={backspace} disabled={disabled || pin.length === 0} />
      </View>
    </View>
  );
}

// A modal that collects a single 4-digit PIN and fires onSubmit. Settings flows
// (change PIN, decoy PIN) chain several of these by changing `title`/`step`.
export function PinModal({
  visible,
  title,
  subtitle,
  step,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  // bump this whenever you advance to a new step so the pad clears between steps
  step?: string | number;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");

  // Clear the entry whenever the modal opens or the caller advances a step.
  useEffect(() => setPin(""), [visible, step]);

  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      const value = pin;
      setPin("");
      onSubmit(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBg}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          {subtitle ? <Text style={styles.modalSub}>{subtitle}</Text> : null}
          <PinPad pin={pin} onChange={setPin} />
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Key({
  label,
  icon,
  onPress,
  disabled,
}: {
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={label ? `pinkey-${label}` : icon ? `pinkey-${icon}` : undefined}
      style={({ pressed }) => [
        styles.key,
        { backgroundColor: pressed ? theme.surfaceAlt : theme.surface, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={26} color={theme.text} />
      ) : (
        <Text style={styles.keyText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 28 },
  dots: { flexDirection: "row", gap: 18 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.muted,
  },
  dotFilled: { backgroundColor: theme.accent, borderColor: theme.accent },
  dotLg: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.muted },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 264,
    justifyContent: "space-between",
    rowGap: 16,
  },
  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
  },
  keyText: { color: theme.text, fontSize: 30, fontWeight: "600" },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: theme.bg,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 24,
    gap: 18,
    alignItems: "center",
  },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "700", textAlign: "center" },
  modalSub: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  cancel: { padding: 8 },
});
