// Switch this device's unlock from a PIN to a secret sequence of chess moves.
// Three steps: confirm the current PIN, play the secret moves, replay them to
// confirm. The move sequence becomes the unlock secret (lower-cost derivation,
// no PIN screen). Reachable from Settings.
import { useState } from "react";
import { Alert, Dimensions, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { Button, Muted, Screen, Title } from "../../src/ui/components";
import { PIN_LENGTH, PinPad } from "../../src/ui/PinPad";
import { theme } from "../../src/ui/theme";
import { GLYPH, initialBoard, legalMoves, move, squareName, type Board, type Color, type Pos } from "../../src/chess/engine";
import { movesToSecret } from "../../src/chess/movekey";

const SIZE = Math.min(Dimensions.get("window").width - 32, 360);
const CELL = SIZE / 8;
const LIGHT = "#ecedd0";
const DARK = "#6f8f57";
const MIN_MOVES = 3;

type Step = "pin" | "record" | "confirm";

export default function ChessSetup() {
  const { vault } = useVault();
  const [step, setStep] = useState<Step>("pin");
  const [pin, setPin] = useState("");
  const [recorded, setRecorded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function onPinChange(next: string) {
    setPin(next);
    if (next.length === PIN_LENGTH) setStep("record");
  }

  async function finish(confirmMoves: string[]) {
    if (confirmMoves.join() !== recorded.join()) {
      Alert.alert("Didn't match", "The two sequences were different. Let's record it again.");
      setRecorded([]);
      setStep("record");
      return;
    }
    setBusy(true);
    try {
      await vault.setChessUnlock(pin, movesToSecret(recorded), recorded.length);
      Alert.alert(
        "Chess unlock set",
        `Your vault now opens by playing your ${recorded.length}-move sequence on the board — no PIN. Keep it secret; there's no way to recover it except your safe words.`
      );
      router.back();
    } catch (e) {
      Alert.alert("Couldn't set it", e instanceof Error ? e.message : "Failed. Check your current PIN.");
      setStep("pin");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  if (step === "pin") {
    return (
      <Screen>
        <Title>Chess unlock</Title>
        <Muted>First, confirm your current PIN.</Muted>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <PinPad pin={pin} onChange={onPinChange} disabled={busy} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{step === "record" ? "Play your secret moves" : "Play them again"}</Title>
      <Muted>
        {step === "record"
          ? `Play at least ${MIN_MOVES} moves from the starting position — this exact sequence becomes your unlock. Make it memorable but not an obvious opening.`
          : "Repeat the same moves to confirm."}
      </Muted>
      <RecorderBoard
        // remount between record/confirm so the board resets
        key={step}
        minMoves={step === "record" ? MIN_MOVES : recorded.length}
        exactLen={step === "confirm" ? recorded.length : undefined}
        onDone={(moves) => {
          if (step === "record") {
            setRecorded(moves);
            setStep("confirm");
          } else {
            void finish(moves);
          }
        }}
      />
    </Screen>
  );
}

function RecorderBoard({
  minMoves,
  exactLen,
  onDone,
}: {
  minMoves: number;
  exactLen?: number;
  onDone: (moves: string[]) => void;
}) {
  const [board, setBoard] = useState<Board>(initialBoard());
  const [turn, setTurn] = useState<Color>("w");
  const [sel, setSel] = useState<Pos | null>(null);
  const [targets, setTargets] = useState<Pos[]>([]);
  const [moves, setMoves] = useState<string[]>([]);

  function reset() {
    setBoard(initialBoard());
    setTurn("w");
    setSel(null);
    setTargets([]);
    setMoves([]);
  }

  function onSquare(r: number, c: number) {
    const piece = board[r][c];
    if (sel) {
      const isTarget = targets.some((t) => t.r === r && t.c === c);
      if (isTarget) {
        const mv = squareName(sel) + squareName({ r, c });
        setBoard(move(board, sel, { r, c }));
        setTurn(turn === "w" ? "b" : "w");
        setSel(null);
        setTargets([]);
        const next = [...moves, mv];
        setMoves(next);
        if (exactLen && next.length === exactLen) onDone(next); // auto-finish on confirm
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
    <View style={{ alignItems: "center", gap: 12 }}>
      <Text style={{ color: theme.muted, fontSize: 13 }}>{moves.length} move{moves.length === 1 ? "" : "s"} played</Text>
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
                  testID={`sq-${squareName({ r, c })}`}
                  onPress={() => onSquare(r, c)}
                  style={{ width: CELL, height: CELL, backgroundColor: isSel ? "#cdd26a" : base, alignItems: "center", justifyContent: "center" }}
                >
                  {piece ? (
                    <Text style={{ fontSize: CELL * 0.7 }}>{GLYPH[piece.color][piece.type]}</Text>
                  ) : isTarget ? (
                    <View style={{ width: CELL * 0.28, height: CELL * 0.28, borderRadius: CELL, backgroundColor: "rgba(0,0,0,0.25)" }} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={reset} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 8, paddingHorizontal: 14 }}>
          <Ionicons name="refresh" size={16} color={theme.muted} />
          <Text style={{ color: theme.muted, fontSize: 14 }}>Restart</Text>
        </Pressable>
        {!exactLen && (
          <View style={{ flex: 1 }}>
            <Button label={`Use these ${moves.length} moves`} onPress={() => onDone(moves)} disabled={moves.length < minMoves} />
          </View>
        )}
      </View>
    </View>
  );
}
