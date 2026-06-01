import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Title } from "../../src/ui/components";
import { PinModal } from "../../src/ui/PinPad";
import { theme } from "../../src/ui/theme";
import { readTextFromUri, saveText } from "../../src/platform/io";
import { biometricHardwareAvailable, promptBiometric } from "../../src/platform/expoKeychain";

export default function Settings() {
  const { vault, lock, setUnlocked, cloud } = useVault();
  const [bioOn, setBioOn] = useState(false);
  const [bioHw, setBioHw] = useState(false);
  const [backupPw, setBackupPw] = useState("");
  const [hasDuress, setHasDuress] = useState(false);
  const [isDecoy, setIsDecoy] = useState(false);

  // PIN-entry modal state machine (drives change PIN, decoy PIN, and the
  // "new device PIN" step of a restore).
  const [pinFlow, setPinFlow] = useState<null | "change" | "decoy" | "restore">(null);
  const [pinStep, setPinStep] = useState("");
  const [stash, setStash] = useState<{ current?: string; next?: string }>({});

  function closePinFlow() {
    setPinFlow(null);
    setPinStep("");
    setStash({});
  }

  async function onChangePin(pin: string) {
    if (pinStep === "current") {
      setStash({ current: pin });
      setPinStep("new");
    } else if (pinStep === "new") {
      setStash((s) => ({ ...s, next: pin }));
      setPinStep("confirm");
    } else {
      // confirm
      if (pin !== stash.next) {
        Alert.alert("PINs don't match", "Enter the new PIN again.");
        setPinStep("new");
        return;
      }
      try {
        await vault.changePassword(stash.current!, stash.next!);
        closePinFlow();
        Alert.alert("Done", "Your PIN has been changed.");
      } catch (e) {
        closePinFlow();
        Alert.alert("Error", e instanceof Error ? e.message : "Failed");
      }
    }
  }

  async function onDecoyPin(pin: string) {
    if (pinStep === "set") {
      setStash({ next: pin });
      setPinStep("confirm");
    } else {
      if (pin !== stash.next) {
        Alert.alert("PINs don't match", "Enter the decoy PIN again.");
        setPinStep("set");
        return;
      }
      try {
        await vault.setDuressPassword(stash.next!);
        setHasDuress(true);
        closePinFlow();
        Alert.alert(
          "Decoy set",
          "Entering this PIN at unlock opens a separate, empty vault — your real items stay hidden."
        );
      } catch (e) {
        closePinFlow();
        Alert.alert("Error", e instanceof Error ? e.message : "Failed");
      }
    }
  }

  // Restore: collect a new 4-digit device PIN (set + confirm), then import.
  async function onRestorePin(pin: string) {
    if (pinStep === "set") {
      setStash({ next: pin });
      setPinStep("confirm");
      return;
    }
    if (pin !== stash.next) {
      Alert.alert("PINs don't match", "Enter the device PIN again.");
      setPinStep("set");
      return;
    }
    const devicePin = stash.next!;
    closePinFlow();
    setBusy(true);
    try {
      await vault.wipe();
      await vault.importVault(restoreArchive!, restoreBackupPw, devicePin);
      setRestoreArchive(null);
      setRestoreBackupPw("");
      setUnlocked(true);
      Alert.alert("Restored", "Your backup has been restored.");
      router.replace("/(vault)/library");
    } catch (e) {
      Alert.alert("Restore failed", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function onPinSubmit(pin: string) {
    if (pinFlow === "change") return onChangePin(pin);
    if (pinFlow === "decoy") return onDecoyPin(pin);
    if (pinFlow === "restore") return onRestorePin(pin);
  }

  function pinTitle(): string {
    if (pinFlow === "change")
      return pinStep === "current" ? "Enter current PIN" : pinStep === "new" ? "Enter new PIN" : "Confirm new PIN";
    if (pinFlow === "decoy") return pinStep === "set" ? "Enter decoy PIN" : "Confirm decoy PIN";
    if (pinFlow === "restore") return pinStep === "set" ? "Set a device PIN" : "Confirm device PIN";
    return "";
  }

  // restore flow
  const [restoreArchive, setRestoreArchive] = useState<string | null>(null);
  const [restoreBackupPw, setRestoreBackupPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    vault.biometricAvailable().then(setBioOn);
    biometricHardwareAvailable().then(setBioHw);
    vault.hasDuress().then(setHasDuress);
    setIsDecoy(vault.isDecoy());
  }, [vault]);

  async function toggleBio() {
    if (bioOn) {
      await vault.disableBiometric();
      setBioOn(false);
      return;
    }
    if (!(await promptBiometric("Enable unlock"))) return;
    await vault.enableBiometric();
    setBioOn(true);
  }

  async function exportBackup() {
    if (backupPw.length < 8) {
      Alert.alert("Weak password", "Backup password must be at least 8 characters.");
      return;
    }
    const archive = await vault.exportVault(backupPw);
    await saveText(`backup-${Date.now()}.json`, archive);
    setBackupPw("");
  }

  // Step 1: pick a backup file and load its contents.
  async function pickRestore() {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/json" });
    if (res.canceled) return;
    const content = await readTextFromUri(res.assets[0].uri);
    setRestoreArchive(content);
  }

  // Step 2: confirm (this REPLACES the current vault), then open the PIN flow to
  // pick a new device PIN; onRestorePin() runs the actual wipe + import.
  function doRestore() {
    if (!restoreArchive) return;
    Alert.alert(
      "Restore backup",
      "This ERASES the current contents and replaces them with the backup. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: () => {
            setStash({});
            setPinStep("set");
            setPinFlow("restore");
          },
        },
      ]
    );
  }

  function confirmWipe() {
    Alert.alert("Erase everything", "Permanently deletes all contents. Cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Erase",
        style: "destructive",
        onPress: async () => {
          await vault.wipe();
          router.replace("/onboarding");
        },
      },
    ]);
  }

  return (
    <>
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, gap: 18 }}>
      <Title>Settings</Title>

      <Section icon="finger-print" title="Unlock with biometrics">
        {bioHw ? (
          <Button
            label={bioOn ? "Disable biometric unlock" : "Enable biometric unlock"}
            onPress={toggleBio}
            variant="outline"
          />
        ) : (
          <Muted>No biometric hardware enrolled on this device.</Muted>
        )}
      </Section>

      <Section icon="key-outline" title="Change PIN">
        <Button
          label="Change PIN"
          onPress={() => {
            setStash({});
            setPinStep("current");
            setPinFlow("change");
          }}
          variant="outline"
        />
      </Section>

      {!isDecoy && (
        <Section icon="eye-off-outline" title="Decoy (duress) PIN">
          <Muted>
            Set a second PIN that opens a separate, empty vault. If anyone ever
            forces you to unlock, give them this one — your real items stay
            encrypted and invisible. {hasDuress ? "A decoy is currently set; setting again replaces it." : ""}
          </Muted>
          <Button
            label={hasDuress ? "Replace decoy PIN" : "Set decoy PIN"}
            onPress={() => {
              setStash({});
              setPinStep("set");
              setPinFlow("decoy");
            }}
            variant="outline"
          />
        </Section>
      )}

      <Section icon="cloud-outline" title="Cloud sync">
        {cloud ? (
          <>
            <Muted>Sync your vault across devices end-to-end encrypted. Caching is opt-in per item.</Muted>
            <Button label="Open cloud sync" onPress={() => router.push("/(vault)/cloud")} variant="outline" />
          </>
        ) : (
          <Muted>Not configured in this build (no Supabase env vars). The vault works fully offline.</Muted>
        )}
      </Section>

      <Section icon="cloud-upload-outline" title="Encrypted backup">
        <Muted>
          Export an encrypted copy of everything, protected by a separate backup
          password. It&apos;s your only recovery path — keep it safe.
        </Muted>
        <Field value={backupPw} onChangeText={setBackupPw} placeholder="Backup password" secureTextEntry />
        <Button label="Export backup" onPress={exportBackup} variant="outline" />
      </Section>

      <Section icon="cloud-download-outline" title="Restore backup">
        {!restoreArchive ? (
          <>
            <Muted>Restore from a backup file. This replaces current contents.</Muted>
            <Button label="Choose backup file…" onPress={pickRestore} variant="outline" />
          </>
        ) : (
          <>
            <Muted>Backup loaded. Enter its backup password — you&apos;ll then pick a new 4-digit PIN for this device.</Muted>
            <Field value={restoreBackupPw} onChangeText={setRestoreBackupPw} placeholder="Backup password" secureTextEntry />
            <Button label="Restore now" onPress={doRestore} loading={busy} />
            <Button label="Cancel" onPress={() => setRestoreArchive(null)} variant="outline" />
          </>
        )}
      </Section>

      <Section icon="warning-outline" title="Danger zone">
        <Button label="Lock now" onPress={lock} variant="outline" />
        <Button label="Erase everything" onPress={confirmWipe} variant="danger" />
      </Section>

      <Muted>
        Everything is AES-256-GCM encrypted at rest with a key derived from your
        password, and the app locks every time you leave it. This protects a lost
        or stolen device. It does not protect against malware on an unlocked or
        jailbroken phone. There is no password recovery — keep a backup.
      </Muted>
    </ScrollView>

    <PinModal
      visible={pinFlow !== null}
      title={pinTitle()}
      step={`${pinFlow}-${pinStep}`}
      onSubmit={onPinSubmit}
      onCancel={closePinFlow}
    />
    </>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={icon} size={18} color={theme.accent} />
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}
