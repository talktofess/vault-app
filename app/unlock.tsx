import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { Screen } from "../src/ui/components";
import { PIN_LENGTH, PinDots } from "../src/ui/PinPad";
import { promptBiometric } from "../src/platform/expoKeychain";

export default function Unlock() {
  const { vault, setUnlocked } = useVault();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasBio, setHasBio] = useState(false);
  const submitting = useRef(false); // re-entrancy guard (avoids the stale-busy race)

  useEffect(() => {
    vault.biometricAvailable().then(setHasBio);
  }, [vault]);

  // Submit automatically once 4 digits are entered. The ref guard (not the
  // `busy` state, which can be stale in this effect's closure) is what prevents
  // a double-submit and the "correct PIN rejected after a wrong one" race.
  useEffect(() => {
    if (pin.length === PIN_LENGTH) void withPin(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function withPin(value: string) {
    if (submitting.current) return;
    submitting.current = true;
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
      submitting.current = false;
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
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <PinDots
          pin={pin}
          onChange={setPin}
          disabled={busy}
          onBiometric={hasBio ? withBiometric : undefined}
        />
      </View>
    </Screen>
  );
}
