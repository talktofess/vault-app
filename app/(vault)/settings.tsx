import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { biometricHardwareAvailable, promptBiometric } from "../../src/platform/expoKeychain";

export default function Settings() {
  const { vault, lock } = useVault();
  const [bioOn, setBioOn] = useState(false);
  const [bioHw, setBioHw] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [backupPw, setBackupPw] = useState("");

  useEffect(() => {
    vault.biometricAvailable().then(setBioOn);
    biometricHardwareAvailable().then(setBioHw);
  }, [vault]);

  async function toggleBio() {
    if (bioOn) {
      await vault.disableBiometric();
      setBioOn(false);
      return;
    }
    if (!(await promptBiometric("Enable biometric unlock"))) return;
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
    const path = FileSystem.cacheDirectory + `vault-backup-${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(path, archive);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
    setBackupPw("");
  }

  async function importBackup() {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/json" });
    if (res.canceled) return;
    Alert.alert(
      "Import backup",
      "Importing requires an empty vault. Use this only on a fresh install.",
      [{ text: "OK" }]
    );
  }

  function confirmWipe() {
    Alert.alert("Erase vault", "This permanently deletes everything. Cannot be undone.", [
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

      <Section title="Biometric unlock">
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

      <Section title="Change master password">
        <Field value={oldPw} onChangeText={setOldPw} placeholder="Current password" secureTextEntry />
        <Field value={newPw} onChangeText={setNewPw} placeholder="New password" secureTextEntry />
        <Button label="Change password" onPress={changePassword} variant="outline" />
      </Section>

      <Section title="Encrypted backup">
        <Muted>
          Export an encrypted copy of your whole vault, protected by a separate
          backup password. Keep it somewhere safe — it&apos;s your only recovery path.
        </Muted>
        <Field value={backupPw} onChangeText={setBackupPw} placeholder="Backup password" secureTextEntry />
        <Button label="Export backup" onPress={exportBackup} variant="outline" />
        <Button label="Import backup (fresh install)" onPress={importBackup} variant="outline" />
      </Section>

      <Section title="Danger zone">
        <Button label="Lock vault" onPress={lock} variant="outline" />
        <Button label="Erase vault" onPress={confirmWipe} variant="danger" />
      </Section>

      <Muted>
        Security note: your data is AES-256-GCM encrypted at rest with a key
        derived from your password. This protects a lost or stolen device. It
        does not protect against malware on an unlocked, compromised, or
        jailbroken phone. There is no password recovery — keep a backup.
      </Muted>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{title}</Text>
      {children}
    </View>
  );
}
