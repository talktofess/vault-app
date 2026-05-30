import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { biometricHardwareAvailable, promptBiometric } from "../../src/platform/expoKeychain";

export default function Settings() {
  const { vault, lock, setUnlocked } = useVault();
  const [bioOn, setBioOn] = useState(false);
  const [bioHw, setBioHw] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [backupPw, setBackupPw] = useState("");
  const [duressPw, setDuressPw] = useState("");
  const [hasDuress, setHasDuress] = useState(false);
  const [isDecoy, setIsDecoy] = useState(false);

  // restore flow
  const [restoreArchive, setRestoreArchive] = useState<string | null>(null);
  const [restoreBackupPw, setRestoreBackupPw] = useState("");
  const [restoreNewPw, setRestoreNewPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    vault.biometricAvailable().then(setBioOn);
    biometricHardwareAvailable().then(setBioHw);
    vault.hasDuress().then(setHasDuress);
    setIsDecoy(vault.isDecoy());
  }, [vault]);

  async function saveDuress() {
    if (duressPw.length < 8) {
      Alert.alert("Weak password", "Decoy password must be at least 8 characters.");
      return;
    }
    try {
      await vault.setDuressPassword(duressPw);
      setDuressPw("");
      setHasDuress(true);
      Alert.alert(
        "Decoy set",
        "Entering this password at unlock opens a separate, empty vault — your real items stay hidden."
      );
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed");
    }
  }

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

  async function changePassword() {
    if (newPw.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters.");
      return;
    }
    try {
      await vault.changePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      Alert.alert("Done", "Master password changed.");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed");
    }
  }

  async function exportBackup() {
    if (backupPw.length < 8) {
      Alert.alert("Weak password", "Backup password must be at least 8 characters.");
      return;
    }
    const archive = await vault.exportVault(backupPw);
    const path = FileSystem.cacheDirectory + `backup-${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(path, archive);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
    setBackupPw("");
  }

  // Step 1: pick a backup file and load its contents.
  async function pickRestore() {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/json" });
    if (res.canceled) return;
    const content = await FileSystem.readAsStringAsync(res.assets[0].uri);
    setRestoreArchive(content);
  }

  // Step 2: confirm (this REPLACES the current vault), then wipe + import.
  async function doRestore() {
    if (!restoreArchive) return;
    if (restoreNewPw.length < 8) {
      Alert.alert("Weak password", "New password must be at least 8 characters.");
      return;
    }
    Alert.alert(
      "Restore backup",
      "This ERASES the current contents and replaces them with the backup. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await vault.wipe();
              await vault.importVault(restoreArchive, restoreBackupPw, restoreNewPw);
              setRestoreArchive(null);
              setRestoreBackupPw("");
              setRestoreNewPw("");
              setUnlocked(true);
              Alert.alert("Restored", "Your backup has been restored.");
              router.replace("/(vault)/media");
            } catch (e) {
              Alert.alert("Restore failed", e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
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

      <Section icon="key-outline" title="Change password">
        <Field value={oldPw} onChangeText={setOldPw} placeholder="Current password" secureTextEntry />
        <Field value={newPw} onChangeText={setNewPw} placeholder="New password" secureTextEntry />
        <Button label="Change password" onPress={changePassword} variant="outline" />
      </Section>

      {!isDecoy && (
        <Section icon="eye-off-outline" title="Decoy (duress) password">
          <Muted>
            Set a second password that opens a separate, empty vault. If anyone
            ever forces you to unlock, give them this one — your real items stay
            encrypted and invisible. {hasDuress ? "A decoy is currently set; saving replaces it." : ""}
          </Muted>
          <Field value={duressPw} onChangeText={setDuressPw} placeholder="Decoy password" secureTextEntry />
          <Button label={hasDuress ? "Replace decoy password" : "Set decoy password"} onPress={saveDuress} variant="outline" />
        </Section>
      )}

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
            <Muted>Backup loaded. Enter its backup password and a new password for this device.</Muted>
            <Field value={restoreBackupPw} onChangeText={setRestoreBackupPw} placeholder="Backup password" secureTextEntry />
            <Field value={restoreNewPw} onChangeText={setRestoreNewPw} placeholder="New device password" secureTextEntry />
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
