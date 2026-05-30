// A small, dependency-free chess engine — enough for a believable playable
// facade (legal piece movement, turns, capture, check-unaware). It is NOT a
// full rules engine (no castling/en passant/checkmate detection); it just needs
// to look and feel like a real game to anyone who opens the app.
//
// It is also the SECRET DOOR: a specific opening sequence of moves (see
// SECRET_SEQUENCE) reveals the vault. That logic lives in the UI; the engine
// only reports moves.

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export interface Piece {
  type: PieceType;
  color: Color;
}
export type Square = Piece | null;
export type Board = Square[][]; // [row 0..7 from top (black) ][col 0..7]

export interface Pos {
  r: number;
  c: number;
}

export function initialBoard(): Board {
  const back: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  const board: Board = Array.from({ length: 8 }, () => Array<Square>(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c], color: "b" };
    board[1][c] = { type: "p", color: "b" };
    board[6][c] = { type: "p", color: "w" };
    board[7][c] = { type: back[c], color: "w" };
  }
  return board;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function ray(board: Board, p: Pos, dirs: number[][], color: Color): Pos[] {
  const out: Pos[] = [];
  for (const [dr, dc] of dirs) {
    let r = p.r + dr;
    let c = p.c + dc;
    while (inBounds(r, c)) {
      const sq = board[r][c];
      if (!sq) out.push({ r, c });
      else {
        if (sq.color !== color) out.push({ r, c });
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return out;
}

// Pseudo-legal moves for the piece at p (ignores check — fine for a facade).
export function legalMoves(board: Board, p: Pos): Pos[] {
  const piece = board[p.r][p.c];
  if (!piece) return [];
  const { type, color } = piece;
  const fwd = color === "w" ? -1 : 1;
  const out: Pos[] = [];
  const push = (r: number, c: number) => {
    if (inBounds(r, c)) {
      const sq = board[r][c];
      if (!sq || sq.color !== color) out.push({ r, c });
    }
  };

  switch (type) {
    case "p": {
      if (inBounds(p.r + fwd, p.c) && !board[p.r + fwd][p.c]) {
        out.push({ r: p.r + fwd, c: p.c });
        const startRow = color === "w" ? 6 : 1;
        if (p.r === startRow && !board[p.r + 2 * fwd][p.c]) {
          out.push({ r: p.r + 2 * fwd, c: p.c });
        }
      }
      for (const dc of [-1, 1]) {
        const r = p.r + fwd;
        const c = p.c + dc;
        if (inBounds(r, c) && board[r][c] && board[r][c]!.color !== color) {
          out.push({ r, c });
        }
      }
      break;
    }
    case "n":
      for (const [dr, dc] of [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
      ]) {
        push(p.r + dr, p.c + dc);
      }
      break;
    case "b":
      out.push(...ray(board, p, [[-1, -1], [-1, 1], [1, -1], [1, 1]], color));
      break;
    case "r":
      out.push(...ray(board, p, [[-1, 0], [1, 0], [0, -1], [0, 1]], color));
      break;
    case "q":
      out.push(
        ...ray(board, p, [
          [-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1],
        ], color)
      );
      break;
    case "k":
      for (const [dr, dc] of [
        [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
      ]) {
        push(p.r + dr, p.c + dc);
      }
      break;
  }
  return out;
}

export function move(board: Board, from: Pos, to: Pos): Board {
  const next = board.map((row) => row.slice());
  const piece = next[from.r][from.c];
  next[to.r][to.c] = piece;
  next[from.r][from.c] = null;
  // auto-queen on promotion (facade nicety)
  if (piece && piece.type === "p" && (to.r === 0 || to.r === 7)) {
    next[to.r][to.c] = { type: "q", color: piece.color };
  }
  return next;
}

export function squareName(p: Pos): string {
  return "abcdefgh"[p.c] + (8 - p.r);
}

export const GLYPH: Record<Color, Record<PieceType, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
