// Cloud sync, "safe words only". No email/verification: the safe words derive a
// hidden Supabase account AND the encryption key. PIN unlocks the device; safe
// words unlock the cloud — that's the whole model. See docs/cloud-architecture.md.
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Title } from "../../src/ui/components";
import { PinModal } from "../../src/ui/PinPad";
import { theme } from "../../src/ui/theme";
import { ensureSignedIn } from "../../src/cloud/account";

const MIN_WORDS = 10;

export default function Cloud() {
  const { vault, cloud, unlocked } = useVault();
  const [linked, setLinked] = useState(false);
  const [safeWords, setSafeWords] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [adoptPin, setAdoptPin] = useState(false); // PIN prompt for merging into an existing cloud vault

  const refresh = useCallback(async () => {
    if (!cloud) return;
    const uid = await cloud.auth.currentUserId();
    setLinked(!!uid && unlocked && (await vault.cloudEnabled(cloud.store)));
  }, [cloud, vault, unlocked]);

  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!cloud) {
    return (
      <Panel>
        <Title>Cloud sync</Title>
        <Muted>
          Cloud isn&apos;t configured in this build. Set EXPO_PUBLIC_SUPABASE_URL and
          EXPO_PUBLIC_SUPABASE_ANON_KEY (see docs/cloud-architecture.md), then rebuild. The vault
          works fully offline without it.
        </Muted>
      </Panel>
    );
  }

  async function connect() {
    if (safeWords.trim().length < MIN_WORDS) {
      Alert.alert("Safe words", `Use at least ${MIN_WORDS} characters. Several unrelated words are ideal — this single secret unlocks your cloud on every device, and there's no recovery if you lose it.`);
      return;
    }
    setBusy("Connecting…");
    try {
      await ensureSignedIn(cloud!.auth, safeWords.trim());
      const uid = await cloud!.auth.currentUserId();
      if (!uid) throw new Error("Sign-in did not complete.");

      if (!(await vault.cloudEnabled(cloud!.store))) {
        await vault.enableCloud(cloud!.store, safeWords.trim()); // first device for these safe words
      } else if (!(await vault.cloudKeyMatchesLocal(cloud!.store, safeWords.trim()))) {
        // A shared cloud vault already exists under a different local key — merge
        // this device in. Confirm with the PIN (needed to re-key the vault).
        setBusy(null);
        setAdoptPin(true);
        return;
      }
      await finishSync(uid);
    } catch (e) {
      handleConnectError(e);
    } finally {
      setBusy(null);
    }
  }

  async function finishSync(uid: string) {
    const pushed = await vault.pushAll(cloud!.store, uid);
    const { added } = await vault.pull(cloud!.store);
    setSafeWords("");
    setLinked(true);
    Alert.alert("Cloud connected", `This device is now part of your vault — uploaded ${pushed}, pulled ${added} new.`);
  }

  async function onAdoptPin(pin: string) {
    setAdoptPin(false);
    setBusy("Merging this device…");
    try {
      await vault.adoptCloudVault(cloud!.store, safeWords.trim(), pin);
      const uid = await cloud!.auth.currentUserId();
      if (uid) await finishSync(uid);
    } catch (e) {
      handleConnectError(e);
    } finally {
      setBusy(null);
    }
  }

  function handleConnectError(e: unknown) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    if (/confirm/i.test(msg)) {
      Alert.alert(
        "Turn off email confirmation",
        "This project still requires email confirmation, which blocks the safe-words sign-in. In Supabase: Authentication → Providers → Email → turn OFF “Confirm email”, then try again."
      );
    } else {
      Alert.alert("Couldn't connect", msg);
    }
  }

  async function syncNow() {
    setBusy("Syncing…");
    try {
      const uid = await cloud!.auth.currentUserId();
      if (!uid) {
        setLinked(false);
        return;
      }
      const pushed = await vault.pushAll(cloud!.store, uid);
      const { added, removed } = await vault.pull(cloud!.store);
      Alert.alert("Synced", `Pushed ${pushed}, pulled ${added} new, removed ${removed}.`);
    } catch (e) {
      Alert.alert("Sync failed", e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    await cloud!.auth.signOut();
    setLinked(false);
  }

  return (
    <Panel>
      <Title>Cloud sync</Title>

      {!linked ? (
        <Section icon="cloud-outline" title="Connect with safe words">
          <Muted>
            Your safe words are the only key to your cloud vault — no email, no account to manage.
            Enter the same words on any device to access your files. Supabase only ever stores
            encrypted data and never sees your safe words.
          </Muted>
          <Field value={safeWords} onChangeText={setSafeWords} placeholder="Your safe words" secureTextEntry />
          <Button label={busy ?? "Connect & sync"} onPress={connect} loading={!!busy} />
        </Section>
      ) : (
        <Section icon="cloud-done-outline" title="Connected">
          <Muted>This device is syncing. Use the same safe words on another device to access everything there.</Muted>
          <Button label={busy ?? "Sync now"} onPress={syncNow} loading={!!busy} />
          <Button label="Disconnect this device" variant="outline" onPress={disconnect} />
        </Section>
      )}

      <Muted>
        Files are encrypted on this device before upload (AES-256-GCM, per-file keys). Caching is
        opt-in per item; offline you can open only cached items. Keep your safe words safe — losing
        them means losing cloud access.
      </Muted>

      <PinModal
        visible={adoptPin}
        title="Enter your PIN to merge"
        subtitle="This account already has a vault. Confirm your device PIN to merge this device's items into it."
        step="adopt"
        onSubmit={onAdoptPin}
        onCancel={() => setAdoptPin(false)}
      />
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, gap: 18 }}>
      {children}
    </ScrollView>
  );
}

function Section({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }) {
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
