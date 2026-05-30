import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../src/ui/components";
import { promptBiometric } from "../src/platform/expoKeychain";

export default function Unlock() {
  const { vault, setUnlocked } = useVault();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasBio, setHasBio] = useState(false);

  useEffect(() => {
    vault.biometricAvailable().then(setHasBio);
  }, [vault]);

  async function withPassword() {
    setBusy(true);
    try {
      const ok = await vault.unlock(pw);
      if (!ok) {
        Alert.alert("Incorrect", "Wrong master password.");
        return;
      }
      setUnlocked(true);
      router.replace("/(vault)/media");
    } finally {
      setBusy(false);
      setPw("");
    }
  }

  async function withBiometric() {
    const ok = await promptBiometric();
    if (!ok) return;
    if (await vault.unlockWithBiometric()) {
      setUnlocked(true);
      router.replace("/(vault)/media");
    }
  }

  // Offer biometrics immediately if enabled.
  useEffect(() => {
    if (hasBio) withBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBio]);

  return (
    <Screen>
      <Title>Unlock vault</Title>
      <Muted>Enter your master password to decrypt your vault.</Muted>
      <Field value={pw} onChangeText={setPw} placeholder="Master password" secureTextEntry autoFocus />
      <Button label="Unlock" onPress={withPassword} loading={busy} />
      {hasBio && <Button label="Use biometrics" onPress={withBiometric} variant="outline" />}
    </Screen>
  );
}
