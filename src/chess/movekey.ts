// The unlock secret derived from a played sequence of chess moves (the user's
// "variation"). Each move is "<from><to>" in algebraic squares, e.g. "e2e4".
// The canonical secret is those moves joined and domain-separated; it's fed to
// the same key-derivation the PIN used, so nothing in the crypto changes — only
// the input does. Promotions/castling notation aren't needed: from+to squares
// uniquely identify each move on the disguise board.
export function movesToSecret(moves: string[]): string {
  return "chesskey-v1|" + moves.map((m) => m.toLowerCase()).join(" ");
}
