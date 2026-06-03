// Cloud sync, "safe words only". No email/verification: the safe words derive a
// hidden Supabase account AND the encryption key. PIN unlocks the device; safe
// words unlock the cloud — that's the whole model. See docs/cloud-architecture.md.
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { ensureSignedIn } from "../../src/cloud/account";
import { SUPABASE_URL } from "../../src/cloud/supabase";
import { errorText } from "../../src/cloud/errors";

const MIN_WORDS = 10;

export default function Cloud() {
  const { vault, cloud, unlocked } = useVault();
  const [linked, setLinked] = useState(false);
  const [safeWords, setSafeWords] = useState("");
  const [showWords, setShowWords] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null); // short uid fingerprint
  const [cloudCount, setCloudCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!cloud) return;
    const uid = await cloud.auth.currentUserId();
    const isLinked = !!uid && unlocked && (await vault.cloudEnabled(cloud.store));
    setLinked(isLinked);
    setAccount(uid ? uid.replace(/-/g, "").slice(0, 8) : null);
    if (isLinked) {
      try {
        setCloudCount(await cloud.store.countItems());
      } catch {
        setCloudCount(null);
      }
    }
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
        // A shared vault already exists — merge this device in. The shared PIN
        // comes from the account, so no extra prompt is needed.
        setBusy("Merging this device…");
        await vault.adoptCloudVault(cloud!.store, safeWords.trim());
      } else {
        // Already the shared vault — make sure the account PIN is seeded.
        await vault.ensureSharedPin(cloud!.store, safeWords.trim());
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
    Alert.alert("Cloud connected", `This device is now part of your vault — uploaded ${pushed}, pulled ${added} new. It unlocks with your account PIN.`);
  }

  function handleConnectError(e: unknown) {
    const msg = errorText(e);
    if (/failed to fetch|network ?request ?failed|load failed|networkerror/i.test(msg)) {
      Alert.alert(
        "Can't reach the cloud",
        `Couldn't connect to ${SUPABASE_URL}.\n\n• Check your internet connection.\n• If you set EXPO_PUBLIC_SUPABASE_URL on Vercel, it must be the API URL (https://<ref>.supabase.co) — NOT the dashboard link.\n\nThen hard-refresh and try again.`
      );
      return;
    }
    if (/permission denied|42501/i.test(msg)) {
      Alert.alert(
        "Cloud setup incomplete",
        "The database is missing table permissions. In Supabase → SQL Editor, run this once, then try again:\n\ngrant usage on schema public to authenticated;\ngrant select, insert, update, delete on public.vault_keys to authenticated;\ngrant select, insert, update, delete on public.items to authenticated;"
      );
      return;
    }
    if (/confirm/i.test(msg)) {
      Alert.alert(
        "Turn off email confirmation",
        "This project still requires email confirmation, which blocks the safe-words sign-in. In Supabase: Authentication → Providers → Email → turn OFF “Confirm email”, then try again."
      );
      return;
    }
    Alert.alert("Couldn't connect", msg);
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
      Alert.alert("Sync failed", errorText(e));
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
            Enter the EXACT same words (same spelling and capitalisation) on every device. Supabase
            only ever stores encrypted data and never sees your safe words.
          </Muted>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field value={safeWords} onChangeText={setSafeWords} placeholder="Your safe words" secureTextEntry={!showWords} />
            </View>
            <Pressable onPress={() => setShowWords((s) => !s)} hitSlop={8} style={{ padding: 8 }}>
              <Ionicons name={showWords ? "eye-off-outline" : "eye-outline"} size={22} color={theme.accent} />
            </Pressable>
          </View>
          <Button label={busy ?? "Connect & sync"} onPress={connect} loading={!!busy} />
          <Text style={{ color: theme.muted, fontSize: 11 }} selectable>
            Server: {SUPABASE_URL}
          </Text>
        </Section>
      ) : (
        <Section icon="cloud-done-outline" title="Connected">
          <Muted>This device is syncing. Use the EXACT same safe words on another device to access everything there.</Muted>
          <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius, padding: 12, gap: 4 }}>
            <Text style={{ color: theme.muted, fontSize: 12 }} selectable>
              Account: <Text style={{ color: theme.text, fontWeight: "700" }}>{account ?? "…"}</Text>{"  "}(must match on every device)
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12 }}>
              Files in cloud: <Text style={{ color: theme.text, fontWeight: "700" }}>{cloudCount ?? "…"}</Text>
            </Text>
          </View>
          <Button label={busy ?? "Sync now"} onPress={syncNow} loading={!!busy} />
          <Button label="Disconnect this device" variant="outline" onPress={disconnect} />
        </Section>
      )}

      <Muted>
        Files are encrypted on this device before upload (AES-256-GCM, per-file keys). Caching is
        opt-in per item; offline you can open only cached items. Keep your safe words safe — losing
        them means losing cloud access.
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
