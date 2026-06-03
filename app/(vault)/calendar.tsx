// Encrypted calendar: birthdays, holidays and one-off events. Birthdays and
// holidays recur every year; events can pin to a specific year. Everything is
// stored sealed under the vault DEK via app-data (never leaves the device in
// the clear). Minimal, tile-friendly UI to match the rest of the app.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";

type Kind = "birthday" | "holiday" | "event";
type CalEvent = { id: string; title: string; month: number; day: number; year?: number; kind: Kind };

const KIND: Record<Kind, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  birthday: { icon: "gift", color: "#caa06a", label: "Birthday" },
  holiday: { icon: "sunny", color: "#b07f2e", label: "Holiday" },
  event: { icon: "calendar", color: "#a9784f", label: "Event" },
};
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const daysInMonth = (m: number, y: number) => new Date(y, m, 0).getDate(); // m is 1-based
const firstDow = (m: number, y: number) => new Date(y, m - 1, 1).getDay();

export default function CalendarScreen() {
  const { vault, unlocked } = useVault();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState({ m: now.getMonth() + 1, y: now.getFullYear() });
  const [editing, setEditing] = useState<{ ev?: CalEvent; month: number; day: number } | null>(null);

  const load = useCallback(() => {
    if (!unlocked) return;
    vault.getAppData<CalEvent[]>("calendar").then((e) => setEvents(e ?? []));
  }, [vault, unlocked]);
  useFocusEffect(load);

  async function persist(next: CalEvent[]) {
    setEvents(next);
    await vault.setAppData("calendar", next);
  }
  async function saveEvent(ev: CalEvent) {
    const next = events.some((e) => e.id === ev.id) ? events.map((e) => (e.id === ev.id ? ev : e)) : [...events, ev];
    await persist(next);
    setEditing(null);
  }
  async function removeEvent(id: string) {
    await persist(events.filter((e) => e.id !== id));
    setEditing(null);
  }

  // events on a given day of the displayed month (recurring match on m/d, or a
  // one-off whose year equals the displayed year)
  const onDay = (d: number) =>
    events.filter((e) => e.month === view.m && e.day === d && (e.year === undefined || e.year === view.y));

  // upcoming across the next 12 months, from today
  const upcoming = useMemo(() => {
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return events
      .map((e) => {
        let y = today.getFullYear();
        let when = new Date(y, e.month - 1, e.day).getTime();
        if (when < t0) when = new Date((y += 1), e.month - 1, e.day).getTime();
        if (e.year !== undefined) when = new Date(e.year, e.month - 1, e.day).getTime();
        return { e, when, y };
      })
      .filter((x) => x.when >= t0)
      .sort((a, b) => a.when - b.when)
      .slice(0, 8);
  }, [events]);

  const totalDays = daysInMonth(view.m, view.y);
  const lead = firstDow(view.m, view.y);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  const shiftMonth = (delta: number) => {
    let m = view.m + delta;
    let y = view.y;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setView({ m, y });
  };
  const isToday = (d: number) => now.getDate() === d && now.getMonth() + 1 === view.m && now.getFullYear() === view.y;

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Title>Calendar</Title>
        <Pressable
          testID="cal-add"
          onPress={() => setEditing({ month: view.m, day: now.getMonth() + 1 === view.m ? now.getDate() : 1 })}
          hitSlop={8}
        >
          <Ionicons name="add-circle" size={30} color={theme.accent} />
        </Pressable>
      </View>

      {/* month nav */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={theme.accent} />
        </Pressable>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>
          {MONTHS[view.m - 1]} {view.y}
        </Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={10}>
          <Ionicons name="chevron-forward" size={24} color={theme.accent} />
        </Pressable>
      </View>

      {/* weekday header */}
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        {DOW.map((d, i) => (
          <Text key={i} style={{ flex: 1, textAlign: "center", color: theme.muted, fontSize: 11, fontWeight: "700" }}>{d}</Text>
        ))}
      </View>

      {/* month grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {cells.map((d, i) => {
          const evs = d ? onDay(d) : [];
          return (
            <Pressable
              key={i}
              disabled={!d}
              onPress={() => d && setEditing({ month: view.m, day: d })}
              style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", padding: 2 }}
            >
              {d ? (
                <View
                  style={{
                    width: "86%",
                    height: "86%",
                    borderRadius: theme.radiusSm,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isToday(d) ? theme.accent : evs.length ? theme.surfaceAlt : "transparent",
                    borderWidth: evs.length && !isToday(d) ? 1 : 0,
                    borderColor: theme.border,
                  }}
                >
                  <Text style={{ color: isToday(d) ? theme.accentText : theme.text, fontWeight: isToday(d) ? "800" : "500", fontSize: 13 }}>{d}</Text>
                  {evs.length > 0 && (
                    <View style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
                      {evs.slice(0, 3).map((e) => (
                        <View key={e.id} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isToday(d) ? theme.accentText : KIND[e.kind].color }} />
                      ))}
                    </View>
                  )}
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* upcoming */}
      <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15, marginTop: 16, marginBottom: 6 }}>Upcoming</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
        {upcoming.length === 0 ? (
          <Muted>No events yet — tap + to add a birthday, holiday or event.</Muted>
        ) : (
          upcoming.map(({ e, y }) => {
            const k = KIND[e.kind];
            const age = e.kind === "birthday" && e.year !== undefined ? ` · turns ${y - e.year}` : "";
            return (
              <Pressable
                key={e.id + y}
                onPress={() => setEditing({ ev: e, month: e.month, day: e.day })}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}
              >
                <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: k.color + "22", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={k.icon} size={20} color={k.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>{e.title}</Text>
                  <Text style={{ color: theme.muted, fontSize: 12 }}>{MONTHS[e.month - 1]} {e.day}{age}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <EventModal
        target={editing}
        onCancel={() => setEditing(null)}
        onSave={saveEvent}
        onDelete={removeEvent}
      />
    </Screen>
  );
}

function EventModal({
  target,
  onCancel,
  onSave,
  onDelete,
}: {
  target: { ev?: CalEvent; month: number; day: number } | null;
  onCancel: () => void;
  onSave: (e: CalEvent) => void;
  onDelete: (id: string) => void;
}) {
  const ev = target?.ev;
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("birthday");
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [year, setYear] = useState("");
  // sync local form state when the target changes
  const key = target ? (ev?.id ?? `${target.month}-${target.day}`) : "none";
  useEffect(() => {
    if (!target) return;
    setTitle(ev?.title ?? "");
    setKind(ev?.kind ?? "birthday");
    setMonth(ev?.month ?? target.month);
    setDay(ev?.day ?? target.day);
    setYear(ev?.year != null ? String(ev.year) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function save() {
    const t = title.trim();
    if (!t) return;
    const y = year.trim() ? parseInt(year.trim(), 10) : undefined;
    onSave({
      id: ev?.id ?? `e${Math.random().toString(36).slice(2)}`,
      title: t,
      month,
      day,
      year: y && !isNaN(y) ? y : undefined,
      kind,
    });
  }

  const clampDay = (d: number) => Math.max(1, Math.min(daysInMonth(month, 2024), d));
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: theme.bg, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 14 }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{ev ? "Edit" : "New"} event</Text>
          <Field value={title} onChangeText={setTitle} placeholder="Title (e.g. Mum's birthday)" autoFocus />

          {/* kind chips */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(Object.keys(KIND) as Kind[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: kind === k ? theme.accent : theme.surface, borderWidth: 1, borderColor: kind === k ? theme.accent : theme.border }}
              >
                <Ionicons name={KIND[k].icon} size={14} color={kind === k ? theme.accentText : theme.muted} />
                <Text style={{ color: kind === k ? theme.accentText : theme.muted, fontSize: 12, fontWeight: "700" }}>{KIND[k].label}</Text>
              </Pressable>
            ))}
          </View>

          {/* month + day steppers */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Stepper label={MONTHS[month - 1].slice(0, 3)} onDown={() => { const m = month === 1 ? 12 : month - 1; setMonth(m); setDay((d) => clampDay(d)); }} onUp={() => { const m = month === 12 ? 1 : month + 1; setMonth(m); setDay((d) => clampDay(d)); }} />
            <Stepper label={`Day ${day}`} onDown={() => setDay((d) => (d <= 1 ? daysInMonth(month, 2024) : d - 1))} onUp={() => setDay((d) => (d >= daysInMonth(month, 2024) ? 1 : d + 1))} />
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: theme.muted, fontSize: 13, width: 96 }}>{kind === "birthday" ? "Birth year" : "Year"} (optional)</Text>
            <View style={{ flex: 1 }}>
              <TextInput value={year} onChangeText={(t) => setYear(t.replace(/\D/g, "").slice(0, 4))} placeholder="—" placeholderTextColor={theme.muted} keyboardType="number-pad" style={{ color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.surface }} />
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            {ev && (
              <Pressable onPress={() => onDelete(ev.id)} style={{ width: 46, height: 46, borderRadius: 12, borderWidth: 1, borderColor: theme.danger, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="trash-outline" size={20} color={theme.danger} />
              </Pressable>
            )}
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="outline" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Save" onPress={save} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Stepper({ label, onUp, onDown }: { label: string; onUp: () => void; onDown: () => void }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.surface, paddingHorizontal: 6, height: 44 }}>
      <Pressable onPress={onDown} hitSlop={8} style={{ padding: 4 }}>
        <Ionicons name="chevron-back" size={18} color={theme.accent} />
      </Pressable>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      <Pressable onPress={onUp} hitSlop={8} style={{ padding: 4 }}>
        <Ionicons name="chevron-forward" size={18} color={theme.accent} />
      </Pressable>
    </View>
  );
}
