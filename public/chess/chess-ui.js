import { Chess } from "./chess.js";
import { StockfishChessEngine } from "./engine-client.js";
import { recognizeChessboardFrame, boardRowsToFen } from "./recognition-client.js";
import {
  createNewChessGame,
  reconcileChessObservation,
  restoreChessGameState,
  seedChessGameFromObservation
} from "./game-state-client.js";

(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const launch = $("#chessAssistantButton");
  const popup = $("#chessDetectionPopup");
  const popupTitle = $("#chessPopupTitle");
  const popupMessage = $("#chessPopupMessage");
  const turnSelector = $("#chessTurnSelector");
  const whiteTurn = $("#chessTurnWhite");
  const blackTurn = $("#chessTurnBlack");
  const suggestButton = $("#chessSuggestMove");
  const trackButton = $("#chessTrackGame");
  const dismissButton = $("#chessDismiss");
  const video = $("#videoPreview");
  const stage = $("#cameraStage");
  const STORAGE_KEY = "askmoina.chess.session.v1";
  const AUTO_KEY = "askmoina.chess.autodetect.v1";
  const MAX_FRAME_BYTES = 512 * 1024;
  const INITIAL_POSITION = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const FIRST_SCAN_DELAY_MS = 1800;
  const BASE_RETRY_MS = 6000;
  const MAX_RETRY_MS = 14000;
  const DISMISS_COOLDOWN_MS = 30000;

  if (!launch || !popup || !popupTitle || !popupMessage || !video) return;

  let engine = null;
  let gameState = null;
  let pendingRecognition = null;
  let pendingMode = "hidden";
  let selectedSide = null;
  let scanning = false;
  let autoTimer = null;
  let autoEnabled = loadAutoSetting();
  let consecutiveMisses = 0;
  let dismissedPlacement = null;
  let dismissedUntil = 0;
  let analysisSequence = 0;
  let statusMessageTimer = null;

  function loadAutoSetting() {
    try {
      const saved = localStorage.getItem(AUTO_KEY);
      return saved === null ? true : saved === "on";
    } catch {
      return true;
    }
  }

  function setStatus(title, message, kind = "info") {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    popupTitle.textContent = title;
    popupMessage.textContent = message;
    popup.dataset.kind = kind;
    popup.hidden = false;
    pendingMode = "message";
    turnSelector.hidden = true;
    suggestButton.hidden = true;
    trackButton.hidden = true;
    dismissButton.textContent = "Done";
    statusMessageTimer = setTimeout(() => {
      if (pendingMode === "message") hidePopup(gameState ? BASE_RETRY_MS : DISMISS_COOLDOWN_MS);
    }, 9000);
  }

  function updateAutoControl() {
    launch.classList.toggle("chess-autodetect-active", autoEnabled);
    launch.classList.toggle("chess-autodetect-paused", !autoEnabled);
    launch.setAttribute("aria-pressed", String(autoEnabled));
    launch.setAttribute("aria-label", autoEnabled ? "Pause automatic chess detection" : "Resume automatic chess detection");
    launch.title = autoEnabled ? "Chess auto-detection is on · tap to pause" : "Chess auto-detection is paused · tap to resume";
  }

  function hidePopup(nextDelay = DISMISS_COOLDOWN_MS) {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    statusMessageTimer = null;
    popup.hidden = true;
    popup.dataset.kind = "info";
    pendingMode = "hidden";
    pendingRecognition = null;
    selectedSide = null;
    if (whiteTurn) whiteTurn.setAttribute("aria-pressed", "false");
    if (blackTurn) blackTurn.setAttribute("aria-pressed", "false");
    scheduleDetection(nextDelay);
  }

  function setSide(color) {
    selectedSide = color;
    whiteTurn.setAttribute("aria-pressed", String(color === "w"));
    blackTurn.setAttribute("aria-pressed", String(color === "b"));
    const enabled = Boolean(selectedSide && pendingRecognition);
    suggestButton.disabled = !enabled;
    trackButton.disabled = !enabled;
  }

  function showBoardPrompt(recognition, options = {}) {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    statusMessageTimer = null;
    pendingRecognition = recognition;
    pendingMode = options.mode || "detected";
    popup.dataset.kind = "info";
    popupTitle.textContent = options.title || "Chessboard detected";
    popupMessage.textContent = options.message || "I can read this board. Choose what you need.";
    popup.hidden = false;
    dismissButton.textContent = "Not now";
    const placement = placementFromRows(recognition.boardRows);
    const knownStart = placement === INITIAL_POSITION;
    selectedSide = options.sideToMove || (knownStart ? "w" : null);
    turnSelector.hidden = Boolean(options.hideTurnChoice || knownStart);
    if (!turnSelector.hidden) {
      setSide(selectedSide);
    } else {
      whiteTurn.setAttribute("aria-pressed", "false");
      blackTurn.setAttribute("aria-pressed", "false");
      suggestButton.disabled = false;
      trackButton.disabled = false;
    }
    suggestButton.hidden = false;
    trackButton.hidden = false;
    suggestButton.textContent = options.suggestLabel || "Suggest a move";
    trackButton.textContent = options.trackLabel || (options.mode === "recover" ? "Resume from here" : "Track game");
    if (options.mode === "recover") {
      popupMessage.textContent = options.message || "The board changed, but I couldn't match one legal move. Confirm whose turn it is to resume here.";
    }
  }

  function showMoveToast(move, sideToMove) {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    statusMessageTimer = null;
    pendingMode = "move";
    pendingRecognition = null;
    selectedSide = sideToMove;
    popup.dataset.kind = "success";
    popupTitle.textContent = "Move detected · " + move.san;
    popupMessage.textContent = colorName(sideToMove) + " to move. I’m watching for the next position.";
    turnSelector.hidden = true;
    suggestButton.hidden = false;
    suggestButton.disabled = false;
    suggestButton.textContent = "Suggest a reply";
    trackButton.hidden = true;
    dismissButton.textContent = "Keep watching";
    popup.hidden = false;
  }

  function colorName(color) {
    return color === "w" ? "White" : "Black";
  }

  function opposite(color) {
    return color === "w" ? "b" : "w";
  }

  function placementFromRows(rows) {
    if (!Array.isArray(rows) || rows.length !== 8) return "";
    return rows.map((row) => {
      let out = "";
      let empty = 0;
      for (const piece of row) {
        if (piece === ".") empty += 1;
        else {
          if (empty) out += String(empty);
          empty = 0;
          out += piece;
        }
      }
      if (empty) out += String(empty);
      return out;
    }).join("/");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function persistGame() {
    try {
      if (gameState) localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      setStatus("Game is active", "I couldn’t save a local recovery copy in this browser.", "warning");
    }
  }

  function restoreGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const restored = restoreChessGameState(JSON.parse(raw));
      if (restored.ok) gameState = restored.state;
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  }

  function getEngine() {
    if (!engine) engine = new StockfishChessEngine({ defaultMoveTimeMs: 1200, searchTimeoutMs: 18000 });
    return engine;
  }

  function cameraIsActive() {
    if (!video.isConnected || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.paused || document.visibilityState === "hidden") return false;
    const stream = video.srcObject;
    if (!stream || typeof stream.getVideoTracks !== "function") return false;
    return stream.getVideoTracks().some((track) => track.readyState === "live" && track.enabled);
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The camera frame could not be compressed.")), "image/jpeg", quality);
    });
  }

  async function captureSingleFrame() {
    if (!cameraIsActive() || !video.videoWidth || !video.videoHeight) {
      throw new Error("The camera preview is not active yet.");
    }
    let width = video.videoWidth;
    let height = video.videoHeight;
    const scale = Math.min(1, 1120 / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare a chess scan.");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      for (const quality of [0.66, 0.56, 0.46, 0.36, 0.28]) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.type === "image/jpeg" && blob.size >= 4 && blob.size <= MAX_FRAME_BYTES) return blob;
      }
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
    throw new Error("Move a little farther back and try again.");
  }

  async function recognizeOneFrame() {
    const frame = await captureSingleFrame();
    return recognizeChessboardFrame(frame);
  }

  function scheduleDetection(delay = BASE_RETRY_MS) {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    if (!autoEnabled) return;
    autoTimer = setTimeout(() => { void detectChessboard(); }, delay);
  }

  async function detectChessboard(manual = false) {
    if (!autoEnabled && !manual) return;
    if (scanning) {
      scheduleDetection(BASE_RETRY_MS);
      return;
    }
    if (!cameraIsActive()) {
      scheduleDetection(1800);
      return;
    }
    if (!manual && !popup.hidden) {
      scheduleDetection(BASE_RETRY_MS);
      return;
    }
    scanning = true;
    try {
      const result = await recognizeOneFrame();
      if (!result.ok) {
        consecutiveMisses += 1;
        if (manual && result.reason !== "no_board" && result.reason !== "partial_board" && result.reason !== "uncertain_recognition" && result.reason !== "orientation_uncertain") {
          setStatus("Couldn’t read the board", result.message || "Try again with all four corners visible.", "warning");
        }
        scheduleDetection(Math.min(MAX_RETRY_MS, BASE_RETRY_MS + consecutiveMisses * 1500));
        return;
      }
      consecutiveMisses = 0;
      const observation = result.recognition;
      const placement = placementFromRows(observation.boardRows);
      if (!placement) {
        scheduleDetection(BASE_RETRY_MS);
        return;
      }

      if (gameState) {
        const currentPlacement = String(gameState.currentFen).split(" ")[0];
        if (placement === currentPlacement) {
          dismissedPlacement = null;
          scheduleDetection(BASE_RETRY_MS + 3000);
          return;
        }
        const nextSide = opposite(new Chess(gameState.currentFen).turn());
        const reconciled = reconcileChessObservation(gameState, {
          boardRows: observation.boardRows,
          orientation: observation.orientation,
          sideToMove: nextSide,
          observedAt: nowIso()
        });
        if (reconciled.ok && reconciled.status === "move-registered") {
          gameState = reconciled.state;
          persistGame();
          showMoveToast(reconciled.move, reconciled.position.sideToMove);
          scheduleDetection(BASE_RETRY_MS + 3000);
          return;
        }
        if (reconciled.ok && reconciled.status === "unchanged") {
          gameState = reconciled.state;
          persistGame();
          scheduleDetection(BASE_RETRY_MS + 3000);
          return;
        }
        showBoardPrompt(observation, {
          mode: "recover",
          message: "The board changed, but I couldn't match one legal move. Confirm whose turn it is to resume here."
        });
        return;
      }

      if (placement === dismissedPlacement && Date.now() < dismissedUntil) {
        scheduleDetection(MAX_RETRY_MS);
        return;
      }
      const isStartingPosition = placement === INITIAL_POSITION;
      showBoardPrompt(observation, {
        mode: "detected",
        sideToMove: isStartingPosition ? "w" : null,
        title: "Chessboard detected",
        message: isStartingPosition
          ? "Looks like a new game. White moves first."
          : "I can read the board. Who moves next?"
      });
    } catch (error) {
      if (manual) setStatus("Chess detection unavailable", error && error.message ? error.message : "Try again when the camera is clear.", "warning");
      consecutiveMisses += 1;
      scheduleDetection(Math.min(MAX_RETRY_MS, BASE_RETRY_MS + consecutiveMisses * 1500));
    } finally {
      scanning = false;
    }
  }

  function setAutoEnabled(value) {
    autoEnabled = Boolean(value);
    try { localStorage.setItem(AUTO_KEY, autoEnabled ? "on" : "off"); } catch {}
    updateAutoControl();
    if (autoEnabled) scheduleDetection(450);
    else if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  function createSeed(observation, sideToMove) {
    return seedChessGameFromObservation({
      boardRows: observation.boardRows,
      orientation: observation.orientation,
      sideToMove: sideToMove,
      observedAt: nowIso()
    }, { playerColor: "w", rightsKnown: false });
  }

  async function trackDetectedPosition() {
    if (!pendingRecognition || !selectedSide || scanning) return;
    const observation = pendingRecognition;
    scanning = true;
    trackButton.disabled = true;
    suggestButton.disabled = true;
    try {
      const placement = placementFromRows(observation.boardRows);
      let result;
      if (placement === INITIAL_POSITION && selectedSide === "w") {
        gameState = createNewChessGame({ playerColor: "w", now: nowIso() });
        gameState.lastBoardRows = observation.boardRows.slice();
        gameState.lastOrientation = observation.orientation;
        gameState.lastObservationAt = nowIso();
        gameState.updatedAt = nowIso();
        result = { ok: true };
      } else {
        result = createSeed(observation, selectedSide);
        if (result.ok) gameState = result.state;
      }
      if (!result.ok) {
        showBoardPrompt(observation, { mode: pendingMode, sideToMove: selectedSide, title: "Check the board", message: result.message || "I couldn't validate this position. Check the view and turn, then try again." });
        popup.dataset.kind = "warning";
        return;
      }
      persistGame();
      hidePopup(6000);
      showTrackedState();
    } catch (error) {
      setStatus("Couldn’t start tracking", error && error.message ? error.message : "Try again with the full board in view.", "warning");
    } finally {
      scanning = false;
      trackButton.disabled = false;
      suggestButton.disabled = false;
    }
  }

  async function suggestMove() {
    let fen;
    let sideToMove;
    try {
      if (pendingMode === "move" && gameState) {
        fen = gameState.currentFen;
        sideToMove = new Chess(fen).turn();
      } else {
        if (!pendingRecognition || !selectedSide) return;
        const position = boardRowsToFen(pendingRecognition.boardRows, selectedSide);
        if (!position.ok) {
          showBoardPrompt(pendingRecognition, { mode: pendingMode, sideToMove: selectedSide, title: "Need a clearer position", message: position.message });
          popup.dataset.kind = "warning";
          return;
        }
        fen = position.fen;
        sideToMove = position.sideToMove;
      }
    } catch (error) {
      setStatus("Position unavailable", error && error.message ? error.message : "Try scanning the board again.", "warning");
      return;
    }
    suggestButton.disabled = true;
    trackButton.disabled = true;
    popupTitle.textContent = "Finding a move…";
    popupMessage.textContent = "Checking the position with Stockfish.";
    const sequence = ++analysisSequence;
    try {
      const analysis = await getEngine().analyzePosition(fen, { movetimeMs: 1200 });
      if (sequence !== analysisSequence) return;
      pendingMode = "message";
      if (!analysis.bestMove) {
        popupTitle.textContent = analysis.status === "checkmate" ? "Checkmate" : analysis.status === "stalemate" ? "Stalemate" : "Draw";
        popupMessage.textContent = "There is no legal move to recommend.";
      } else {
        popupTitle.textContent = "Suggested move · " + analysis.bestMove.san;
        popupMessage.textContent = colorName(sideToMove) + " to move. " + analysis.bestMove.san + " (" + analysis.bestMove.uci + ") is Stockfish’s recommendation.";
      }
      popup.dataset.kind = "success";
      turnSelector.hidden = true;
      suggestButton.hidden = true;
      trackButton.hidden = true;
      dismissButton.textContent = gameState ? "Keep watching" : "Done";
      pendingRecognition = null;
      if (statusMessageTimer) clearTimeout(statusMessageTimer);
      statusMessageTimer = setTimeout(() => hidePopup(gameState ? BASE_RETRY_MS : DISMISS_COOLDOWN_MS), 12000);
    } catch (error) {
      popupTitle.textContent = "Move suggestion unavailable";
      popupMessage.textContent = error && error.message ? error.message : "Stockfish couldn't finish this analysis. Try again.";
      popup.dataset.kind = "warning";
      suggestButton.hidden = true;
      trackButton.hidden = true;
      dismissButton.textContent = "Done";
      if (statusMessageTimer) clearTimeout(statusMessageTimer);
      statusMessageTimer = setTimeout(() => hidePopup(gameState ? BASE_RETRY_MS : DISMISS_COOLDOWN_MS), 9000);
    } finally {
      suggestButton.disabled = false;
      trackButton.disabled = false;
    }
  }

  function showTrackedState() {
    if (!gameState) return;
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    const game = new Chess(gameState.currentFen);
    pendingMode = "message";
    popupTitle.textContent = "Game tracking is on";
    popupMessage.textContent = "I’ll watch for the next move while the camera is active. " + colorName(game.turn()) + " to move.";
    popup.dataset.kind = "success";
    turnSelector.hidden = true;
    suggestButton.hidden = false;
    suggestButton.disabled = false;
    suggestButton.textContent = "Suggest a move";
    trackButton.hidden = true;
    dismissButton.textContent = "Keep watching";
    popup.hidden = false;
    statusMessageTimer = setTimeout(() => hidePopup(BASE_RETRY_MS), 6500);
    scheduleDetection(9000);
  }

  launch.addEventListener("click", () => setAutoEnabled(!autoEnabled));
  whiteTurn.addEventListener("click", () => setSide("w"));
  blackTurn.addEventListener("click", () => setSide("b"));
  suggestButton.addEventListener("click", () => { void suggestMove(); });
  trackButton.addEventListener("click", () => { void trackDetectedPosition(); });
  dismissButton.addEventListener("click", () => {
    if (pendingRecognition) {
      dismissedPlacement = placementFromRows(pendingRecognition.boardRows);
      dismissedUntil = Date.now() + DISMISS_COOLDOWN_MS;
    }
    hidePopup(gameState ? BASE_RETRY_MS : DISMISS_COOLDOWN_MS);
  });
  video.addEventListener("play", () => scheduleDetection(FIRST_SCAN_DELAY_MS));
  video.addEventListener("loadeddata", () => scheduleDetection(FIRST_SCAN_DELAY_MS));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleDetection(650);
    else if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  });
  if (stage) {
    const observer = new MutationObserver(() => {
      if (cameraIsActive()) scheduleDetection(FIRST_SCAN_DELAY_MS);
    });
    observer.observe(stage, { attributes: true, attributeFilter: ["class"] });
  }

  restoreGame();
  updateAutoControl();
  scheduleDetection(FIRST_SCAN_DELAY_MS);
  window.addEventListener("pagehide", () => {
    if (autoTimer) clearTimeout(autoTimer);
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    analysisSequence += 1;
    if (engine) engine.dispose();
  });
})();
