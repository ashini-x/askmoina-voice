import { Chess } from "./chess.js";
import { StockfishChessEngine } from "./engine-client.js";
import { recognizeChessboardFrame } from "./recognition-client.js";
import {
  boardRowsForFen,
  createNewChessGame,
  reconcileChessObservation,
  restoreChessGameState,
  seedChessGameFromObservation
} from "./game-state-client.js";

(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const launch = $("#chessAssistantButton");
  const overlay = $("#chessAssistantOverlay");
  const closeButton = $("#chessClose");
  const video = $("#videoPreview");
  const statusNode = $("#chessStatus");
  const resultNode = $("#chessResult");
  const positionNode = $("#chessPosition");
  const nextMoveNode = $("#chessNextMove");
  const moveListNode = $("#chessMoveList");
  const playerColorNode = $("#chessPlayerColor");
  const sideToMoveNode = $("#chessSideToMove");
  const rightsKnownNode = $("#chessRightsKnown");
  const rightCheckboxes = ["#chessRightK", "#chessRightQ", "#chessRightk", "#chessRightq"].map($);
  const scanButton = $("#chessScan");
  const seedButton = $("#chessSeedPosition");
  const newGameButton = $("#chessNewGame");
  const busyNodes = [scanButton, seedButton, newGameButton];
  const STORAGE_KEY = "askmoina.chess.session.v1";
  const MAX_FRAME_BYTES = 512 * 1024;
  let scanning = false;
  let engine = null;
  let gameState = null;
  let analysisSequence = 0;

  if (!launch || !overlay || !video || !statusNode) return;

  function setStatus(message, kind = "info") {
    statusNode.textContent = message;
    statusNode.dataset.kind = kind;
  }

  function colorName(color) {
    return color === "w" ? "White" : "Black";
  }

  function readPlayerColor() {
    return playerColorNode.value === "b" ? "b" : "w";
  }

  function readSideToMove() {
    return sideToMoveNode.value === "b" ? "b" : "w";
  }

  function readCastlingRights() {
    return ["K", "Q", "k", "q"].filter((right, index) => rightCheckboxes[index] && rightCheckboxes[index].checked).join("");
  }

  function persistGame() {
    try {
      if (gameState) localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      setStatus("The game is active, but this browser could not save the local recovery copy.", "warning");
    }
  }

  function restoreGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const result = restoreChessGameState(JSON.parse(raw));
      if (result.ok) {
        gameState = result.state;
        sideToMoveNode.value = new Chess(gameState.currentFen).turn();
        playerColorNode.value = gameState.playerColor;
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  }

  function renderPosition(position, move) {
    if (!position) return;
    resultNode.hidden = false;
    positionNode.textContent = position.fen;
    if (move) {
      nextMoveNode.textContent = colorName(move.color) + " played " + move.san + " (" + move.uci + "). Next to move: " + colorName(position.sideToMove) + ".";
    } else {
      nextMoveNode.textContent = "Position loaded. " + colorName(position.sideToMove) + " to move; " + position.legalMoveCount + " legal moves.";
    }
    moveListNode.replaceChildren();
    if (!gameState || !gameState.moveHistory.length) {
      const item = document.createElement("li");
      item.textContent = gameState && gameState.gameMode === "new-game" ? "New game · start position confirmed" : "Position seeded · earlier moves not available";
      moveListNode.appendChild(item);
    } else {
      gameState.moveHistory.slice(-12).forEach((entry) => {
        const item = document.createElement("li");
        const moveNumber = Math.ceil(entry.ply / 2);
        item.textContent = String(moveNumber) + (entry.color === "w" ? ". " : "… ") + entry.san;
        moveListNode.appendChild(item);
      });
    }
    if (gameState && !gameState.rightsKnown) {
      const note = document.createElement("li");
      note.className = "chess-history-warning";
      note.textContent = "Historical castling/en-passant rights are unknown for this seeded position; moves requiring unknown rights will not be inferred.";
      moveListNode.appendChild(note);
    }
  }

  function getEngine() {
    if (!engine) engine = new StockfishChessEngine({ defaultMoveTimeMs: 1200, searchTimeoutMs: 18000 });
    return engine;
  }

  async function analyzeCurrentPosition() {
    if (!gameState) return;
    const sequence = ++analysisSequence;
    const currentFen = gameState.currentFen;
    setStatus("Position validated. Stockfish is analysing the next move…");
    try {
      const analysis = await getEngine().analyzePosition(currentFen, { movetimeMs: 1200 });
      if (sequence !== analysisSequence || !gameState || gameState.currentFen !== currentFen) return;
      if (!analysis.bestMove) {
        nextMoveNode.textContent = analysis.status === "checkmate" ? "Checkmate." : analysis.status === "stalemate" ? "Stalemate." : "The game is drawn.";
        setStatus("Analysis ready · " + analysis.status + ".", "success");
        return;
      }
      nextMoveNode.textContent = colorName(analysis.sideToMove) + " to move. Best move: " + analysis.bestMove.san + " (" + analysis.bestMove.uci + ").";
      setStatus("Analysis ready · " + analysis.engine + ".", "success");
    } catch (error) {
      if (sequence !== analysisSequence) return;
      setStatus("The board and game state were saved, but Stockfish analysis failed: " + (error && error.message ? error.message : "engine unavailable") + ". Try again.", "warning");
    }
  }

  function openPanel() {
    overlay.hidden = false;
    document.body.classList.add("chess-panel-open");
    launch.setAttribute("aria-expanded", "true");
    closeButton.focus();
    if (gameState) {
      const game = new Chess(gameState.currentFen);
      renderPosition({ fen: gameState.currentFen, sideToMove: game.turn(), legalMoveCount: game.moves().length }, null);
      setStatus("Saved chess game restored on this device.");
    } else {
      setStatus("Choose New game or Use current position. A scan only runs when you tap a chess action.");
    }
  }

  function closePanel() {
    overlay.hidden = true;
    document.body.classList.remove("chess-panel-open");
    launch.setAttribute("aria-expanded", "false");
    launch.focus();
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The camera frame could not be compressed.")), "image/jpeg", quality);
    });
  }

  async function captureSingleFrame() {
    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error("The live camera preview is not ready yet. Open moinaOS 1 and allow camera access, then try again.");
    }
    let width = video.videoWidth;
    let height = video.videoHeight;
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare a chess scan.");
    for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      for (const quality of [0.76, 0.66, 0.56, 0.46, 0.36, 0.28]) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.type === "image/jpeg" && blob.size >= 4 && blob.size <= MAX_FRAME_BYTES) return blob;
      }
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
    throw new Error("The frame is too large to send safely. Move a little farther back and scan again.");
  }

  function setBusy(value) {
    scanning = value;
    busyNodes.forEach((node) => { if (node) node.disabled = value; });
    launch.disabled = false;
  }

  async function requestRecognition() {
    const imageBlob = await captureSingleFrame();
    return recognizeChessboardFrame(imageBlob, { sideToMove: readSideToMove() });
  }

  async function seedCurrentPosition() {
    if (scanning) return;
    setBusy(true);
    setStatus("Capturing one frame and checking whether the full board is visible…");
    try {
      const recognized = await requestRecognition();
      if (!recognized.ok) {
        setStatus(recognized.message, "warning");
        return;
      }
      const rightsKnown = Boolean(rightsKnownNode.checked);
      const seeded = seedChessGameFromObservation({
        boardRows: recognized.recognition.boardRows,
        orientation: recognized.recognition.orientation,
        sideToMove: readSideToMove()
      }, {
        playerColor: readPlayerColor(),
        rightsKnown: rightsKnown,
        castlingRights: rightsKnown ? readCastlingRights() : null
      });
      if (!seeded.ok) {
        setStatus(seeded.message, "warning");
        return;
      }
      gameState = seeded.state;
      persistGame();
      sideToMoveNode.value = seeded.state.currentFen.split(" ")[1];
      renderPosition(seeded.position, null);
      const rightsMessage = rightsKnown ? " Confirmed castling rights will be tracked." : " Historical castling/en-passant rights remain unknown and will not be guessed.";
      setStatus("Position seeded successfully." + rightsMessage, "success");
      await analyzeCurrentPosition();
    } catch (error) {
      setStatus(error && error.message ? error.message : "The chess scan did not complete.", "warning");
    } finally {
      setBusy(false);
    }
  }

  async function scanAndUpdate() {
    if (scanning) return;
    if (!gameState) {
      setStatus("Start a new game or use current position before updating it.", "warning");
      return;
    }
    setBusy(true);
    setStatus("Capturing one frame and comparing it with the last confirmed position…");
    try {
      const recognized = await requestRecognition();
      if (!recognized.ok) {
        setStatus(recognized.message, "warning");
        return;
      }
      const result = reconcileChessObservation(gameState, {
        boardRows: recognized.recognition.boardRows,
        orientation: recognized.recognition.orientation,
        sideToMove: readSideToMove()
      });
      if (!result.ok) {
        setStatus(result.message, "warning");
        return;
      }
      gameState = result.state;
      persistGame();
      sideToMoveNode.value = result.position.sideToMove;
      renderPosition(result.position, result.move);
      if (result.status === "unchanged") {
        setStatus(result.orientationChanged ? "Same board confirmed after the camera orientation changed. Move history is unchanged." : "Same position confirmed. No duplicate move was added.", "success");
      } else {
        setStatus("Legal move recorded · " + result.move.san + ". Move history saved on this device.", "success");
      }
      await analyzeCurrentPosition();
    } catch (error) {
      setStatus(error && error.message ? error.message : "The chess scan did not complete.", "warning");
    } finally {
      setBusy(false);
    }
  }

  function beginNewGame() {
    if (scanning) return;
    gameState = createNewChessGame({ playerColor: readPlayerColor() });
    persistGame();
    sideToMoveNode.value = "w";
    rightCheckboxes.forEach((node) => { if (node) node.checked = false; });
    rightsKnownNode.checked = false;
    renderPosition({ fen: gameState.currentFen, sideToMove: "w", legalMoveCount: new Chess(gameState.currentFen).moves().length }, null);
    setStatus("New game ready. Scan the physical starting position to confirm it before recording moves.", "success");
    void analyzeCurrentPosition();
  }

  launch.addEventListener("click", () => overlay.hidden ? openPanel() : closePanel());
  closeButton.addEventListener("click", closePanel);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || (event.target instanceof Element && event.target.closest("[data-chess-dismiss]"))) closePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) closePanel();
  });
  newGameButton.addEventListener("click", beginNewGame);
  seedButton.addEventListener("click", () => { void seedCurrentPosition(); });
  scanButton.addEventListener("click", () => { void scanAndUpdate(); });
  rightsKnownNode.addEventListener("change", () => {
    rightCheckboxes.forEach((node) => { if (node) node.disabled = !rightsKnownNode.checked; });
  });
  rightCheckboxes.forEach((node) => { if (node) node.disabled = !rightsKnownNode.checked; });

  restoreGame();
  launch.setAttribute("aria-expanded", "false");
  if (gameState) setStatus("Saved chess game available on this device. Open Chess to continue.");
  window.addEventListener("pagehide", () => {
    analysisSequence += 1;
    if (engine) engine.dispose();
  });
})();
