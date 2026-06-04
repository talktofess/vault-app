// The disguise: a real, playable chess board shown when the vault is locked.
// To anyone who opens "Offline Chess" it's just a chess app.
//
// Two secret doors, depending on how this vault is configured:
//  • Chess-move unlock (chessLen set): play your secret sequence of moves from
//    the opening position; after the Nth move the vault unlocks. Wrong moves
//    just look like a game — tap "New game" to retry. No PIN screen, and the
//    move secret's entropy lets the key derivation run fewer rounds (faster).
//  • PIN unlock (legacy): a fixed sequence of corner taps reveals the PIN screen.
import { useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
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
import { movesToSecret } from "../src/chess/movekey";
import { theme } from "../src/ui/theme";

// Legacy secret entry: tap these squares in this exact order to reveal the PIN.
const SECRET = ["a1", "h8", "h1", "a8"];

const SIZE = Math.min(Dimensions.get("window").width - 24, 380);
const CELL = SIZE / 8;
const LIGHT = "#ecedd0";
const DARK = "#6f8f57";

export default function Chess() {
  const { vault, setUnlocked } = useVault();
  const [board, setBoard] = useState<Board>(initialBoard());
  const [turn, setTurn] = useState<Color>("w");
  const [sel, setSel] = useState<Pos | null>(null);
  const [targets, setTargets] = useState<Pos[]>([]);
  const [progress, setProgress] = useState(0); // legacy corner-tap progress
  const [chessLen, setChessLen] = useState<number | null>(null);
  const played = useRef<string[]>([]); // moves since the opening, "<from><to>"
  const tried = useRef(false); // only one unlock attempt per N-move run

  useEffect(() => {
    vault.getChessLen().then(setChessLen);
  }, [vault]);

  function checkSecret(name: string) {
    if (chessLen) return; // chess-move unlock handles entry instead
    if (name === SECRET[progress]) {
      const next = progress + 1;
      if (next === SECRET.length) {
        setProgress(0);
        router.push("/unlock");
      } else {
        setProgress(next);
      }
    } else {
      setProgress(name === SECRET[0] ? 1 : 0);
    }
  }

  // After the user completes their secret number of moves, derive the key from
  // the move sequence and try to unlock. Silent on failure (it just looks like a
  // game in progress); "New game" resets for another attempt.
  async function tryChessUnlock(seq: string[]) {
    if (!chessLen || tried.current || seq.length !== chessLen) return;
    tried.current = true;
    try {
      // logFailure=false: a non-matching sequence is just a chess game, not a
      // break-in — don't log an intrusion or trip the lockout.
      if (await vault.unlock(movesToSecret(seq), false)) {
        setUnlocked(true);
        router.replace("/(vault)/library");
      }
    } catch {
      /* stay on the board */
    }
  }

  function onSquare(r: number, c: number) {
    checkSecret(squareName({ r, c }));

    const piece = board[r][c];
    if (sel) {
      const isTarget = targets.some((t) => t.r === r && t.c === c);
      if (isTarget) {
        const mv = squareName(sel) + squareName({ r, c });
        setBoard(move(board, sel, { r, c }));
        setTurn(turn === "w" ? "b" : "w");
        setSel(null);
        setTargets([]);
        if (chessLen) {
          played.current = [...played.current, mv];
          void tryChessUnlock(played.current);
        }
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

  function newGame() {
    setBoard(initialBoard());
    setTurn("w");
    setSel(null);
    setTargets([]);
    played.current = [];
    tried.current = false;
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
                  testID={`sq-${squareName({ r, c })}`}
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
      <Pressable onPress={newGame}>
        <Text style={{ color: theme.muted, fontSize: 14 }}>New game</Text>
      </Pressable>
    </View>
  );
}
