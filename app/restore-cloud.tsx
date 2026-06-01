// New-device bootstrap, "safe words only": enter your safe words -> the app
// signs into the hidden derived account, recovers the encryption key, you pick a
// new local PIN, and it pulls your vault. No email. Reached from onboarding.
import { useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../src/ui/components";
import { PIN_LENGTH, PinPad } from "../src/ui/PinPad";
import { ensureSignedIn } from "../src/cloud/account";

type Stage = "words" | "setPin" | "confirmPin";

export default function RestoreCloud() {
  const { vault, cloud, setUnlocked } = useVault();
  const [stage, setStage] = useState<Stage>("words");
  const [safeWords, setSafeWords] = useState("");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (!cloud) {
    return (
      <Screen>
        <Title>Restore from cloud</Title>
        <Muted>Cloud isn&apos;t configured in this build, so there&apos;s nothing to restore from.</Muted>
        <Button label="Back" variant="outline" onPress={() => router.back()} />
      </Screen>
    );
  }

  async function continueFromWords() {
    if (safeWords.trim().length < 10) {
      Alert.alert("Safe words", "Enter the safe words you used when connecting cloud.");
      return;
    }
    setBusy("Checking…");
    try {
      await ensureSignedIn(cloud!.auth, safeWords.trim());
      if (!(await vault.cloudEnabled(cloud!.store))) {
        Alert.alert("No cloud vault", "No vault exists for these safe words yet. Double-check them, or start a new vault instead.");
        return;
      }
      if (!(await vault.checkCloudPassphrase(cloud!.store, safeWords.trim()))) {
        Alert.alert("Wrong safe words", "Those safe words don't open this vault.");
        return;
      }
      setStage("setPin");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      Alert.alert(
        /confirm/i.test(msg) ? "Turn off email confirmation" : "Couldn't continue",
        /confirm/i.test(msg)
          ? "In Supabase: Authentication → Providers → Email → turn OFF “Confirm email”, then try again."
          : msg
      );
    } finally {
      setBusy(null);
    }
  }

  function onPin(value: string) {
    setPin(value);
    if (value.length !== PIN_LENGTH || busy) return;
    if (stage === "setPin") {
      setFirstPin(value);
      setPin("");
      setStage("confirmPin");
      return;
    }
    if (value !== firstPin) {
      Alert.alert("PINs don't match", "Let's try again.");
      setFirstPin("");
      setPin("");
      setStage("setPin");
      return;
    }
    finish(value);
  }

  async function finish(devicePin: string) {
    setBusy("Restoring…");
    try {
      const { pulled } = await vault.restoreFromCloud(cloud!.store, safeWords.trim(), devicePin);
      setUnlocked(true);
      Alert.alert("Vault restored", `Pulled ${pulled} item${pulled === 1 ? "" : "s"}. Tap an item to download it.`);
      router.replace("/(vault)/library");
    } catch (e) {
      Alert.alert("Restore failed", e instanceof Error ? e.message : "Failed.");
      setStage("words");
      setPin("");
      setFirstPin("");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <Title>Restore from cloud</Title>

      {stage === "words" && (
        <>
          <Muted>Enter your safe words — the single secret that unlocks your cloud vault. They derive your account and decrypt your files; Supabase never had them.</Muted>
          <Field value={safeWords} onChangeText={setSafeWords} placeholder="Your safe words" secureTextEntry />
          <Button label={busy ?? "Continue"} onPress={continueFromWords} loading={!!busy} />
          <Button label="Back" variant="outline" onPress={() => router.back()} />
        </>
      )}

      {(stage === "setPin" || stage === "confirmPin") && (
        <>
          <Muted>{stage === "setPin" ? "Choose a 4-digit PIN for this device." : "Confirm the PIN."}</Muted>
          <View style={{ flex: 1, justifyContent: "center" }}>
            <PinPad pin={pin} onChange={onPin} disabled={!!busy} />
          </View>
        </>
      )}
    </Screen>
  );
}
