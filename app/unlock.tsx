import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { Muted, Screen, Title } from "../src/ui/components";
import { PIN_LENGTH, PinPad } from "../src/ui/PinPad";
import { promptBiometric } from "../src/platform/expoKeychain";

export default function Unlock() {
  const { vault, setUnlocked } = useVault();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasBio, setHasBio] = useState(false);

  useEffect(() => {
    vault.biometricAvailable().then(setHasBio);
  }, [vault]);

  // Submit automatically once 4 digits are entered.
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !busy) withPin(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function withPin(value: string) {
    setBusy(true);
    try {
      const wait = await vault.lockoutRemainingMs();
      if (wait > 0) {
        Alert.alert("Locked out", `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`);
        setPin("");
        return;
      }
      const ok = await vault.unlock(value);
      if (!ok) {
        Alert.alert("Incorrect", "Wrong PIN.");
        setPin("");
        return;
      }
      const intr = vault.getIntrusions();
      if (intr.length > 0) {
        const last = new Date(intr[intr.length - 1]).toLocaleString();
        Alert.alert(
          "Failed attempts detected",
          `${intr.length} failed unlock attempt${intr.length === 1 ? "" : "s"} since your last sign-in. Most recent: ${last}.`
        );
      }
      setUnlocked(true);
      router.replace("/(vault)/library");
    } finally {
      setBusy(false);
    }
  }

  async function withBiometric() {
    const ok = await promptBiometric();
    if (!ok) return;
    if (await vault.unlockWithBiometric()) {
      setUnlocked(true);
      router.replace("/(vault)/library");
    }
  }

  // Offer biometrics immediately if enabled.
  useEffect(() => {
    if (hasBio) withBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBio]);

  return (
    <Screen>
      <Title>Enter your PIN</Title>
      <Muted>Enter your 4-digit PIN to unlock your vault.</Muted>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <PinPad
          pin={pin}
          onChange={setPin}
          disabled={busy}
          onBiometric={hasBio ? withBiometric : undefined}
        />
      </View>
    </Screen>
  );
}
