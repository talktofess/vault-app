import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { Button, Muted, Screen, Title } from "../src/ui/components";
import { PIN_LENGTH, PinPad } from "../src/ui/PinPad";

// Two-step PIN setup: enter a 4-digit PIN, then confirm it. The PIN is just the
// "password" the vault crypto derives a key from — short by design, but the
// vault still locks instantly on exit and rate-limits guesses after 5 failures.
export default function Onboarding() {
  const { vault, setUnlocked, cloud } = useVault();
  const [stage, setStage] = useState<"set" | "confirm">("set");
  const [first, setFirst] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  // Advance / submit automatically once 4 digits are entered.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || busy) return;
    if (stage === "set") {
      setFirst(pin);
      setPin("");
      setStage("confirm");
      return;
    }
    // stage === "confirm"
    if (pin !== first) {
      Alert.alert("PINs don't match", "Let's try again.");
      setFirst("");
      setPin("");
      setStage("set");
      return;
    }
    create(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function create(value: string) {
    setBusy(true);
    try {
      await vault.create(value);
      setUnlocked(true);
      // Offer the chess-move unlock right away so the PIN screen can be skipped
      // entirely from here on (you'll re-enter this PIN once to authorise it).
      Alert.alert(
        "Vault created",
        "Prefer to unlock by playing a secret sequence of chess moves instead of typing this PIN? You can change this any time in Settings.",
        [
          { text: "Keep the PIN", onPress: () => router.replace("/(vault)/library") },
          { text: "Use chess moves", onPress: () => router.replace("/(vault)/chess-setup") },
        ]
      );
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not create vault");
      setFirst("");
      setPin("");
      setStage("set");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{stage === "set" ? "Choose a 4-digit PIN" : "Confirm your PIN"}</Title>
      <Muted>
        {stage === "set"
          ? "This PIN unlocks your vault. There's no recovery if you forget it — keep an encrypted backup as your safety net."
          : "Enter the same 4 digits again to confirm."}
      </Muted>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <PinPad pin={pin} onChange={setPin} disabled={busy} />
      </View>
      {stage === "set" && cloud && (
        <Button
          label="Already have a cloud vault? Restore"
          variant="outline"
          onPress={() => router.push("/restore-cloud")}
        />
      )}
    </Screen>
  );
}
