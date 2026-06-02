// A lightweight Markdown renderer for notes — no external dependency, works on
// native and web. Supports headings, bold/italic/code, bullet & numbered lists,
// tappable task checkboxes (- [ ] / - [x]), blockquotes, code blocks, and rules.
// When onToggleCheckbox is given, tapping a checkbox reports its SOURCE line
// index so the editor can flip it and persist.
import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";

// Inline: **bold**, *italic*, `code`.
function inline(s: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<Text key={key++} style={{ fontWeight: "800" }}>{t.slice(2, -2)}</Text>);
    else if (t.startsWith("`")) out.push(<Text key={key++} style={styles.code}>{t.slice(1, -1)}</Text>);
    else out.push(<Text key={key++} style={{ fontStyle: "italic" }}>{t.slice(1, -1)}</Text>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Markdown({ source, onToggleCheckbox }: { source: string; onToggleCheckbox?: (lineIndex: number) => void }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <View key={blocks.length} style={styles.codeBlock}>
          <Text style={styles.code}>{code.join("\n")}</Text>
        </View>
      );
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      blocks.push(
        <Text key={blocks.length} style={[styles.h, { fontSize: lvl === 1 ? 24 : lvl === 2 ? 20 : 17 }]}>
          {inline(h[2])}
        </Text>
      );
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<View key={blocks.length} style={styles.hr} />);
      i++;
      continue;
    }

    const cb = /^\s*-\s\[([ xX])\]\s+(.*)$/.exec(line);
    if (cb) {
      const checked = cb[1].toLowerCase() === "x";
      const idx = i;
      blocks.push(
        <Pressable key={blocks.length} onPress={() => onToggleCheckbox?.(idx)} style={styles.row} disabled={!onToggleCheckbox}>
          <Ionicons name={checked ? "checkbox" : "square-outline"} size={21} color={checked ? theme.accent : theme.muted} />
          <Text style={[styles.body, { flex: 1 }, checked && { textDecorationLine: "line-through", color: theme.muted }]}>{inline(cb[2])}</Text>
        </Pressable>
      );
      i++;
      continue;
    }

    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (b) {
      blocks.push(
        <View key={blocks.length} style={styles.row}>
          <Text style={styles.bullet}>•</Text>
          <Text style={[styles.body, { flex: 1 }]}>{inline(b[1])}</Text>
        </View>
      );
      i++;
      continue;
    }

    const n = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (n) {
      blocks.push(
        <View key={blocks.length} style={styles.row}>
          <Text style={styles.bullet}>{n[1]}.</Text>
          <Text style={[styles.body, { flex: 1 }]}>{inline(n[2])}</Text>
        </View>
      );
      i++;
      continue;
    }

    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      blocks.push(
        <View key={blocks.length} style={styles.quote}>
          <Text style={[styles.body, { color: theme.muted }]}>{inline(q[1])}</Text>
        </View>
      );
      i++;
      continue;
    }

    if (line.trim() === "") {
      blocks.push(<View key={blocks.length} style={{ height: 9 }} />);
      i++;
      continue;
    }

    blocks.push(<Text key={blocks.length} style={styles.body}>{inline(line)}</Text>);
    i++;
  }
  return <View>{blocks}</View>;
}

const styles = StyleSheet.create({
  body: { color: theme.text, fontSize: 17, lineHeight: 25 },
  h: { color: theme.text, fontWeight: "800", marginTop: 10, marginBottom: 2, letterSpacing: -0.3 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 3 },
  bullet: { color: theme.accent, fontSize: 17, lineHeight: 25, minWidth: 18 },
  code: { fontFamily: "monospace", fontSize: 14, color: theme.accent },
  codeBlock: { backgroundColor: theme.surfaceAlt, borderRadius: theme.radiusSm, padding: 12, marginVertical: 6 },
  hr: { height: 1, backgroundColor: theme.border, marginVertical: 12 },
  quote: { borderLeftWidth: 3, borderLeftColor: theme.border, paddingLeft: 12, marginVertical: 4 },
});
