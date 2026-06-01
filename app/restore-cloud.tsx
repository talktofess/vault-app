// New-device bootstrap: open an existing cloud vault on a fresh install.
// Flow: sign in (Supabase Auth) -> enter the encryption passphrase -> choose a
// new local PIN -> recover the account DEK and pull. Reached from onboarding.
import { useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../src/ui/components";
import { PIN_LENGTH, PinPad } from "../src/ui/PinPad";

type Stage = "auth" | "passphrase" | "setPin" | "confirmPin";

export default function RestoreCloud() {
  const { vault, cloud, setUnlocked } = useVault();
  const [stage, setStage] = useState<Stage>("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
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

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert("Couldn't continue", e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function signIn() {
    await withBusy("Signing in…", async () => {
      await cloud!.auth.signIn(email.trim(), password);
      setPassword("");
      if (!(await vault.cloudEnabled(cloud!.store))) {
        Alert.alert("No cloud vault", "This account has no cloud vault to restore. Sign in with the account you linked, or start a new vault instead.");
        return;
      }
      setStage("passphrase");
    });
  }

  async function checkPassphrase() {
    if (passphrase.length < 8) {
      Alert.alert("Passphrase", "Enter the passphrase you set when enabling cloud.");
      return;
    }
    await withBusy("Checking…", async () => {
      const ok = await vault.checkCloudPassphrase(cloud!.store, passphrase);
      if (!ok) {
        Alert.alert("Wrong passphrase", "That passphrase doesn't open this account's vault.");
        return;
      }
      setStage("setPin");
    });
  }

  // PIN entry drives itself once PIN_LENGTH digits are entered.
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
    await withBusy("Restoring…", async () => {
      const { pulled } = await vault.restoreFromCloud(cloud!.store, passphrase, devicePin);
      setUnlocked(true);
      Alert.alert("Vault restored", `Linked this device and pulled ${pulled} item${pulled === 1 ? "" : "s"}. Tap an item to download it.`);
      router.replace("/(vault)/library");
    });
  }

  return (
    <Screen>
      <Title>Restore from cloud</Title>

      {stage === "auth" && (
        <>
          <Muted>Sign in to the account that has your cloud vault.</Muted>
          <Field value={email} onChangeText={setEmail} placeholder="Email" />
          <Field value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
          <Button label={busy ?? "Sign in"} onPress={signIn} loading={!!busy} />
          <Button label="Back" variant="outline" onPress={() => router.back()} />
        </>
      )}

      {stage === "passphrase" && (
        <>
          <Muted>Enter your encryption passphrase — the zero-knowledge key that protects your files. Supabase never had it, so only you can unlock here.</Muted>
          <Field value={passphrase} onChangeText={setPassphrase} placeholder="Encryption passphrase" secureTextEntry />
          <Button label={busy ?? "Continue"} onPress={checkPassphrase} loading={!!busy} />
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
