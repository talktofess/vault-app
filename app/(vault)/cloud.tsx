// Cloud sync control panel: sign in/up (Supabase Auth = identity only), set the
// zero-knowledge passphrase (the cloud encryption root), link this device, and
// sync. The 4-digit PIN is never involved here — see docs/cloud-architecture.md.
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";

export default function Cloud() {
  const { vault, cloud, unlocked } = useVault();
  const [userId, setUserId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!cloud) return;
    const uid = await cloud.auth.currentUserId();
    setUserId(uid);
    if (uid && unlocked) setEnabled(await vault.cloudEnabled(cloud.store));
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
          EXPO_PUBLIC_SUPABASE_ANON_KEY (see docs/cloud-architecture.md), then rebuild.
          The vault works fully offline without it.
        </Muted>
      </Panel>
    );
  }

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert("Cloud error", e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function signIn() {
    await withBusy("Signing in…", async () => {
      await cloud!.auth.signIn(email.trim(), password);
      setPassword("");
      await refresh();
    });
  }
  async function signUp() {
    await withBusy("Creating account…", async () => {
      await cloud!.auth.signUp(email.trim(), password);
      Alert.alert("Check your email", "Confirm your address if required, then sign in.");
      setPassword("");
      await refresh();
    });
  }
  async function signOut() {
    await withBusy("Signing out…", async () => {
      await cloud!.auth.signOut();
      await refresh();
    });
  }

  // Enable (first time) or link this device, then do a first sync.
  async function enableOrLink() {
    if (passphrase.length < 8) {
      Alert.alert("Weak passphrase", "Use at least 8 characters — this is your cloud encryption root.");
      return;
    }
    const uid = await cloud!.auth.currentUserId();
    if (!uid) return;
    await withBusy("Linking…", async () => {
      const exists = await vault.cloudEnabled(cloud!.store);
      if (!exists) {
        await vault.enableCloud(cloud!.store, passphrase);
      } else if (!(await vault.cloudKeyMatchesLocal(cloud!.store, passphrase))) {
        throw new Error(
          "This account already has a cloud vault under a different passphrase/key. " +
            "To use it on this device, do a fresh install and restore from it instead of linking."
        );
      }
      setPassphrase("");
      const pushed = await vault.pushAll(cloud!.store, uid);
      const { added } = await vault.pull(cloud!.store);
      setEnabled(true);
      Alert.alert("Cloud linked", `Uploaded ${pushed} item(s); pulled ${added} new.`);
    });
  }

  async function syncNow() {
    const uid = await cloud!.auth.currentUserId();
    if (!uid) return;
    await withBusy("Syncing…", async () => {
      const pushed = await vault.pushAll(cloud!.store, uid);
      const { added, removed } = await vault.pull(cloud!.store);
      Alert.alert("Synced", `Pushed ${pushed}, pulled ${added} new, removed ${removed}.`);
    });
  }

  return (
    <Panel>
      <Title>Cloud sync</Title>

      {!userId ? (
        <Section icon="person-circle-outline" title="Account">
          <Muted>Sign in to sync your vault across devices. This identity is separate from your encryption passphrase.</Muted>
          <Field value={email} onChangeText={setEmail} placeholder="Email" />
          <Field value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
          <Button label={busy ?? "Sign in"} onPress={signIn} loading={!!busy} />
          <Button label="Create account" onPress={signUp} variant="outline" />
        </Section>
      ) : (
        <>
          <Section icon="checkmark-circle-outline" title="Signed in">
            <Muted>Account: {userId.slice(0, 8)}… {enabled ? "· cloud linked" : "· not linked yet"}</Muted>
            <Button label="Sign out" onPress={signOut} variant="outline" />
          </Section>

          {!enabled ? (
            <Section icon="lock-closed-outline" title="Encryption passphrase">
              <Muted>
                Sets (or links to) the zero-knowledge key that protects your files in the cloud.
                Supabase never sees it. There&apos;s no recovery if you lose it — keep it safe.
              </Muted>
              <Field value={passphrase} onChangeText={setPassphrase} placeholder="Strong passphrase" secureTextEntry />
              <Button label="Enable / link cloud" onPress={enableOrLink} loading={!!busy} />
            </Section>
          ) : (
            <Section icon="sync-outline" title="Sync">
              <Muted>Uploads new local items and pulls changes from your other devices.</Muted>
              <Button label="Sync now" onPress={syncNow} loading={!!busy} />
            </Section>
          )}
        </>
      )}

      <Muted>
        Files are encrypted on this device before upload (AES-256-GCM, per-file keys). Supabase stores
        only ciphertext. Caching is opt-in per item; offline you can open only cached items.
      </Muted>
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
