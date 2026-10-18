const MAX_CONTEXT_CHARS = 1450;
const FEN_PATTERN = /^([prnbqkPRNBQK1-8/]+) ([wb]) (?:-|K?Q?k?q?) (?:-|[a-h][36]) (\d{1,6}) (\d{1,6})$/;

function clean(value, max = 80) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isUsableFen(value) {
  if (typeof value !== "string" || value.length > 110) return false;
  const match = value.match(FEN_PATTERN);
  if (!match) return false;
  const ranks = match[1].split("/");
  if (ranks.length !== 8) return false;
  return ranks.every((rank) => {
    let squares = 0;
    for (const char of rank) {
      if (/[1-8]/.test(char)) squares += Number(char);
      else if (/[prnbqkPRNBQK]/.test(char)) squares += 1;
      else return false;
    }
    return squares === 8;
  });
}

function safeSan(value) {
  const san = clean(value, 20);
  return /^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?[+#]?|[+#])$/.test(san)
    ? san
    : "";
}

/** Build a bounded voice prompt from the tracked position; never guess missing state. */
export function buildChessVoiceContext(state, options = {}) {
  if (!state || typeof state !== "object" || !isUsableFen(state.currentFen)) return null;

  const kind = ["tracking", "move", "analysis", "resume"].includes(options.kind) ? options.kind : "resume";
  const fen = state.currentFen;
  const sideToMove = fen.split(" ")[1] === "w" ? "White" : "Black";
  const historyComplete = state.historyStatus === "complete" && state.gameMode !== "midgame-seed";
  const history = Array.isArray(state.moveHistory) ? state.moveHistory : [];
  const recent = history.slice(-8).map((item, index) => {
    const san = safeSan(item && item.san);
    const ply = Number.isInteger(item && item.ply) && item.ply > 0
      ? item.ply
      : history.length - Math.min(history.length, 8) + index + 1;
    return san ? String(ply) + ". " + san : "";
  }).filter(Boolean);

  const lines = [
    "CHESS CONTEXT UPDATE — validated local game state.",
    "Use this as the current position for chess questions. Do not invent a move, prior history, engine analysis, or certainty not supplied here.",
    "Current FEN: " + fen,
    "Side to move: " + sideToMove + ".",
    historyComplete
      ? "Move history: locally tracked from the starting position; only recorded legal moves are included."
      : "Move history: INCOMPLETE. This began from a photographed mid-game position. Earlier moves, en-passant eligibility, and historical rights are unknown; do not infer them."
  ];
  if (recent.length) lines.push("Recent tracked legal moves (oldest first): " + recent.join("; ") + ".");

  if (kind === "tracking") {
    lines.push("The user just chose Track game. Briefly acknowledge that tracking is on and invite a chess question. Do not volunteer an unrequested analysis.");
  } else if (kind === "move") {
    const move = options.move && typeof options.move === "object" ? options.move : null;
    const san = safeSan(move && move.san);
    if (san) {
      const from = clean(move.from, 2);
      const to = clean(move.to, 2);
      lines.push("One legal camera-observed move was reconciled against the last known position: " + san +
        (/^[a-h][1-8]$/.test(from) && /^[a-h][1-8]$/.test(to) ? " (" + from + " to " + to + ")" : "") +
        ". Acknowledge only this recorded move and the side to move. Do not add an unsupported tactical claim.");
    } else {
      lines.push("A tracked position changed, but no safe move description was supplied. Do not name a move; ask the user to rescan if needed.");
    }
  } else if (kind === "analysis") {
    const bestMove = options.analysis && options.analysis.bestMove;
    const san = safeSan(bestMove && bestMove.san);
    const uci = clean(bestMove && bestMove.uci, 5);
    if (!san || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
    lines.push("The user tapped Suggest a move. Stockfish's returned best move for this exact FEN is " + san + " (UCI " + uci + "). Explain the idea briefly using the supplied board position. Do not invent a principal variation, calculation, tactic, score, or guarantee that was not supplied. Do not claim to have analyzed a different position.");
  } else {
    lines.push("A previously tracked position was restored from this browser. Do not claim the camera has just re-confirmed it. Briefly acknowledge the position and invite the user to ask about it.");
  }
  return lines.join("\n").slice(0, MAX_CONTEXT_CHARS);
}
