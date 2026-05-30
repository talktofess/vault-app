// The disguise: a real, playable chess board shown when the vault is locked.
// To anyone who opens "Offline Chess" it's just a chess app. The SECRET DOOR is
// a fixed sequence of corner taps (see SECRET) — enter it to reach the unlock
// screen. Any wrong tap quietly resets the sequence, so there's no hint it
// exists.
import { useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  GLYPH,
  initialBoard,
  legalMoves,
  move,
  squareName,
  type Board,
  type Color,
  type Pos,
} from "../src/chess/engine";
import { theme } from "../src/ui/theme";

// Secret entry: tap these squares in this exact order to reveal the vault.
// a1 (bottom-left), h8 (top-right), h1 (bottom-right), a8 (top-left).
const SECRET = ["a1", "h8", "h1", "a8"];

const SIZE = Math.min(Dimensions.get("window").width - 24, 380);
const CELL = SIZE / 8;
const LIGHT = "#ecedd0";
const DARK = "#6f8f57";

export default function Chess() {
  const [board, setBoard] = useState<Board>(initialBoard());
  const [turn, setTurn] = useState<Color>("w");
  const [sel, setSel] = useState<Pos | null>(null);
  const [targets, setTargets] = useState<Pos[]>([]);
  const [progress, setProgress] = useState(0); // secret-sequence progress

  function checkSecret(name: string) {
    if (name === SECRET[progress]) {
      const next = progress + 1;
      if (next === SECRET.length) {
        setProgress(0);
        router.push("/unlock");
      } else {
        setProgress(next);
      }
    } else {
      // restart (allow this tap to also start a new sequence)
      setProgress(name === SECRET[0] ? 1 : 0);
    }
  }

  function onSquare(r: number, c: number) {
    checkSecret(squareName({ r, c }));

    const piece = board[r][c];
    if (sel) {
      const isTarget = targets.some((t) => t.r === r && t.c === c);
      if (isTarget) {
        setBoard(move(board, sel, { r, c }));
        setTurn(turn === "w" ? "b" : "w");
        setSel(null);
        setTargets([]);
        return;
      }
    }
    if (piece && piece.color === turn) {
      setSel({ r, c });
      setTargets(legalMoves(board, { r, c }));
    } else {
      setSel(null);
      setTargets([]);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", gap: 18 }}>
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700" }}>Offline Chess</Text>
      <Text style={{ color: theme.muted, fontSize: 14 }}>
        {turn === "w" ? "White" : "Black"} to move
      </Text>
      <View style={{ width: SIZE, height: SIZE, borderRadius: 8, overflow: "hidden" }}>
        {board.map((row, r) => (
          <View key={r} style={{ flexDirection: "row" }}>
            {row.map((piece, c) => {
              const isSel = sel?.r === r && sel?.c === c;
              const isTarget = targets.some((t) => t.r === r && t.c === c);
              const base = (r + c) % 2 === 0 ? LIGHT : DARK;
              return (
                <Pressable
                  key={c}
                  onPress={() => onSquare(r, c)}
                  style={{
                    width: CELL,
                    height: CELL,
                    backgroundColor: isSel ? "#cdd26a" : base,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {piece ? (
                    <Text style={{ fontSize: CELL * 0.7 }}>{GLYPH[piece.color][piece.type]}</Text>
                  ) : isTarget ? (
                    <View
                      style={{
                        width: CELL * 0.28,
                        height: CELL * 0.28,
                        borderRadius: CELL,
                        backgroundColor: "rgba(0,0,0,0.25)",
                      }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <Pressable
        onPress={() => {
          setBoard(initialBoard());
          setTurn("w");
          setSel(null);
          setTargets([]);
        }}
      >
        <Text style={{ color: theme.muted, fontSize: 14 }}>New game</Text>
      </Pressable>
    </View>
  );
}
