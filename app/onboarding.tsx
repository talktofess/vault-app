import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../src/ui/components";

export default function Onboarding() {
  const { vault, setUnlocked } = useVault();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (pw.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters.");
      return;
    }
    if (pw !== confirm) {
      Alert.alert("Mismatch", "The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await vault.create(pw);
      setUnlocked(true);
      router.replace("/(vault)/media");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not create vault");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Set a master password</Title>
      <Muted>
        This password encrypts everything in your vault. There is no recovery if
        you forget it — only your encrypted backup can restore the vault. Choose
        something strong and memorable.
      </Muted>
      <Field value={pw} onChangeText={setPw} placeholder="Master password" secureTextEntry autoFocus />
      <Field value={confirm} onChangeText={setConfirm} placeholder="Confirm password" secureTextEntry />
      <Button label="Create vault" onPress={create} loading={busy} />
    </Screen>
  );
}
