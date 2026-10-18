import { Chess } from "./chess.js";
import { StockfishChessEngine } from "./engine-client.js";
import { recognizeChessboardFrame, boardRowsToFen, verifyStableChessboardRecognition, inferUserColorFromOrientation } from "./recognition-client.js?v=0.4.139";
import { buildChessVoiceContext } from "./voice-context.js";
import {
  createNewChessGame,
  isPlayersTurn,
  reconcileChessObservation,
  restoreChessGameState,
  seedChessGameFromObservation
} from "./game-state-client.js?v=0.4.140";

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
  const STORAGE_KEY = "askmoina.chess.session.v3";
  const LEGACY_STORAGE_KEYS = ["askmoina.chess.session.v1", "askmoina.chess.session.v2"];
  const AUTO_KEY = "askmoina.chess.autodetect.v2";
  const MAX_FRAME_BYTES = 512 * 1024;
  const INITIAL_POSITION = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const FIRST_SCAN_DELAY_MS = 1800;
  const BASE_RETRY_MS = 4000;
  const MAX_RETRY_MS = 10000;
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
  let lastRecognitionCompletedAt = 0;
  let pendingRecognitionConfirmation = null;
  let lastSuggestedFen = null;
  let queuedRecommendationFen = null;
  const CONFIRM_SCAN_INTERVAL_MS = 1050;

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
    launch.setAttribute("aria-label", autoEnabled ? "Chess assistant on. Automatic board detection is active; tap to pause." : "Chess assistant off. Tap to resume automatic board detection.");
    launch.title = autoEnabled ? "Chess assistant · watching for a board · tap to pause" : "Chess assistant · paused · tap to resume";
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
    popupTitle.textContent = "Next strong move";
    const placement = placementFromRows(recognition.boardRows);
    const knownStart = placement === INITIAL_POSITION;
    const userColor = inferUserColorFromOrientation(recognition.orientation) || "w";
    selectedSide = options.sideToMove || (knownStart ? "w" : userColor);
    popupMessage.textContent = options.message || (knownStart
      ? "Chess detected. " + colorName(userColor) + " is your side; White moves first."
      : "Chess detected. Near side is " + colorName(userColor) + ". I’ll use that as your default color.");
    popup.hidden = false;
    dismissButton.textContent = "Not now";
    turnSelector.hidden = true;
    whiteTurn.setAttribute("aria-pressed", String(selectedSide === "w"));
    blackTurn.setAttribute("aria-pressed", String(selectedSide === "b"));
    suggestButton.hidden = false;
    suggestButton.disabled = false;
    suggestButton.textContent = "Next strong move";
    suggestButton.classList.add("chess-popup-action-primary");
    trackButton.hidden = true;
    scheduleDetection(BASE_RETRY_MS);
  }

  function showMoveToast(move, sideToMove) {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    statusMessageTimer = null;
    pendingMode = "move";
    pendingRecognition = null;
    pendingRecognitionConfirmation = null;
    selectedSide = sideToMove;
    popup.dataset.kind = "success";
    popupTitle.textContent = "Next strong move";
    turnSelector.hidden = true;
    suggestButton.hidden = false;
    suggestButton.textContent = "Next strong move";
    suggestButton.classList.add("chess-popup-action-primary");
    trackButton.hidden = true;
    dismissButton.textContent = "Not now";
    popup.hidden = false;

    const moveLabel = move && move.san ? "Move registered (" + move.san + "). " : "Position updated. ";
    if (isPlayersTurn(gameState)) {
      popupMessage.textContent = moveLabel + (autoEnabled
        ? "Your turn. Calculating your next strong move…"
        : "Your turn. Tap Next strong move when you're ready.");
      suggestButton.disabled = autoEnabled;
      if (autoEnabled) queueAutomaticRecommendation();
    } else {
      const playerColor = gameState && gameState.playerColor ? gameState.playerColor : opposite(sideToMove);
      popupMessage.textContent = moveLabel + colorName(sideToMove) +
        " to move. I'll automatically show your next strong move when it's " +
        colorName(playerColor) + "'s turn.";
      suggestButton.disabled = true;
    }
    scheduleDetection(BASE_RETRY_MS);
  }

  function colorName(color) {
    return color === "w" ? "White" : "Black";
  }

  function showWaitingForUserTurn(sideToMove) {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    statusMessageTimer = null;
    pendingMode = "waiting";
    popup.dataset.kind = "info";
    popupTitle.textContent = "Next strong move";
    popupMessage.textContent = colorName(sideToMove) +
      " to move. I'll calculate your next strong move automatically when it's your turn (" +
      colorName(gameState && gameState.playerColor ? gameState.playerColor : opposite(sideToMove)) + ").";
    turnSelector.hidden = true;
    suggestButton.hidden = false;
    suggestButton.disabled = true;
    suggestButton.textContent = "Next strong move";
    suggestButton.classList.add("chess-popup-action-primary");
    trackButton.hidden = true;
    dismissButton.textContent = "Not now";
    popup.hidden = false;
    scheduleDetection(BASE_RETRY_MS);
  }

  function queueAutomaticRecommendation() {
    if (!autoEnabled || !gameState || !isPlayersTurn(gameState)) return;
    const fen = gameState.currentFen;
    if (lastSuggestedFen === fen || queuedRecommendationFen === fen) return;
    queuedRecommendationFen = fen;

    const startWhenReady = () => {
      if (queuedRecommendationFen !== fen) return;
      if (!autoEnabled || !gameState || gameState.currentFen !== fen || !isPlayersTurn(gameState)) {
        queuedRecommendationFen = null;
        return;
      }
      if (scanning) {
        window.setTimeout(startWhenReady, 250);
        return;
      }
      if (popup.hidden) {
        queuedRecommendationFen = null;
        if (isPlayersTurn(gameState)) suggestButton.disabled = false;
        return;
      }
      queuedRecommendationFen = null;
      void suggestMove({ automatic: true });
    };
    window.setTimeout(startWhenReady, 0);
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

  function emitChessVoiceContext(kind, details = {}) {
    let state = gameState;
    if (details.fen) {
      state = {
        ...(gameState || {}),
        currentFen: details.fen,
        moveHistory: gameState && Array.isArray(gameState.moveHistory) ? gameState.moveHistory : [],
        historyStatus: gameState ? gameState.historyStatus : "incomplete",
        gameMode: gameState ? gameState.gameMode : "midgame-seed"
      };
    }
    const message = buildChessVoiceContext(state, {
      kind,
      move: details.move,
      analysis: details.analysis
    });
    if (message) {
      window.dispatchEvent(new CustomEvent("askmoina:chess-context-update", {
        detail: { kind, message }
      }));
    }
    return message;
  }

  window.__askmoinaChessVoiceContext = (kind = "resume") =>
    buildChessVoiceContext(gameState, { kind });

  function persistGame() {
    try {
      if (gameState) localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      setStatus("Game is active", "I couldn’t save a local recovery copy in this browser.", "warning");
    }
  }

  function restoreGame() {
    // A pre-fix tracked position may have been seeded from a wrong camera read.
    // Discard it on upgrade so it cannot bypass the two-scan verification guard.
    for (const key of LEGACY_STORAGE_KEYS) {
      try { localStorage.removeItem(key); } catch {}
    }
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
    if (!video.isConnected || (stage && !stage.classList.contains("has-camera")) || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.paused || document.visibilityState === "hidden") return false;
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
    const result = await recognizeChessboardFrame(frame);
    lastRecognitionCompletedAt = Date.now();
    return result;
  }

  async function confirmStableRecognition(firstRecognition) {
    // Start a confirmation while the glass prompt is already visible.
    const elapsed = Date.now() - lastRecognitionCompletedAt;
    const waitMs = Math.max(0, CONFIRM_SCAN_INTERVAL_MS - elapsed);
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const secondResult = await recognizeOneFrame();
    return verifyStableChessboardRecognition({
      ok: true,
      recognition: firstRecognition
    }, secondResult);
  }

  function startBackgroundConfirmation(recognition) {
    const placement = placementFromRows(recognition.boardRows);
    if (!placement) return null;
    if (pendingRecognitionConfirmation && pendingRecognitionConfirmation.placement === placement) {
      return pendingRecognitionConfirmation.promise;
    }
    const entry = { placement, promise: null, result: null };
    entry.promise = confirmStableRecognition(recognition).catch((error) => ({
      ok: false,
      reason: "confirmation_scan_failed",
      message: error && error.message ? error.message : "Couldn't confirm the board. Keep it still and try again."
    })).then((result) => {
      entry.result = result;
      if (result.ok && pendingRecognition && placementFromRows(pendingRecognition.boardRows) === placement) {
        pendingRecognition = result.recognition;
      }
      return result;
    });
    pendingRecognitionConfirmation = entry;
    return entry.promise;
  }

  async function getConfirmedRecognition(recognition) {
    const placement = placementFromRows(recognition && recognition.boardRows);
    if (!placement) return { ok: false, message: "The board reading is incomplete. Scan again." };
    let result;
    if (pendingRecognitionConfirmation && pendingRecognitionConfirmation.placement === placement) {
      result = await pendingRecognitionConfirmation.promise;
    }
    if (!result || !result.ok) {
      pendingRecognitionConfirmation = null;
      if (result) return result;
      result = await confirmStableRecognition(recognition).catch((error) => ({
        ok: false,
        reason: "confirmation_scan_failed",
        message: error && error.message ? error.message : "Couldn't confirm the board. Keep it still and try again."
      }));
    }
    return result;
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
      let observation = result.recognition;
      let placement = placementFromRows(observation.boardRows);
      if (!placement) {
        scheduleDetection(BASE_RETRY_MS);
        return;
      }

      if (gameState) {
        const currentPlacement = String(gameState.currentFen).split(" ")[0];
        if (placement === currentPlacement) {
          if (popup.hidden && placement === dismissedPlacement && Date.now() < dismissedUntil) {
            scheduleDetection(MAX_RETRY_MS);
            return;
          }
          if (popup.hidden) showTrackedState();
          scheduleDetection(BASE_RETRY_MS);
          return;
        }
        const confirmation = await confirmStableRecognition(observation);
        if (!confirmation.ok) {
          setStatus("Couldn’t confirm the position", confirmation.message, "warning");
          return;
        }
        observation = confirmation.recognition;
        placement = placementFromRows(observation.boardRows);
        if (!placement) {
          setStatus("Couldn’t confirm the position", "The second board reading was incomplete. Keep all four corners visible and scan again.", "warning");
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
          emitChessVoiceContext("move", { move: reconciled.move });
          scheduleDetection(BASE_RETRY_MS);
          return;
        }
        if (reconciled.ok && reconciled.status === "unchanged") {
          gameState = reconciled.state;
          persistGame();
          scheduleDetection(BASE_RETRY_MS);
          return;
        }
        showBoardPrompt(observation, {
          mode: "recover",
          message: "The board changed by more than one tracked move. Near side is your default color; confirm the board reading with Next strong move."
        });
        void startBackgroundConfirmation(observation);
        return;
      }

      if (placement === dismissedPlacement && Date.now() < dismissedUntil) {
        scheduleDetection(MAX_RETRY_MS);
        return;
      }
      if (!popup.hidden && pendingRecognition && placementFromRows(pendingRecognition.boardRows) === placement) {
        scheduleDetection(BASE_RETRY_MS);
        return;
      }
      showBoardPrompt(observation);
      void startBackgroundConfirmation(observation);
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
    if (autoEnabled) {
      scheduleDetection(450);
      queueAutomaticRecommendation();
    } else {
      if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
      if (queuedRecommendationFen) {
        queuedRecommendationFen = null;
        if (gameState && isPlayersTurn(gameState)) suggestButton.disabled = false;
      }
    }
  }

  function createSeed(observation, sideToMove, playerColor) {
    return seedChessGameFromObservation({
      boardRows: observation.boardRows,
      orientation: observation.orientation,
      sideToMove: sideToMove,
      observedAt: nowIso()
    }, { playerColor: playerColor || inferUserColorFromOrientation(observation.orientation) || "w", rightsKnown: false });
  }

  async function trackDetectedPosition() {
    if (!pendingRecognition || !selectedSide || scanning) return;
    let observation = pendingRecognition;
    scanning = true;
    trackButton.disabled = true;
    suggestButton.disabled = true;
    try {
      const confirmation = await confirmStableRecognition(observation);
      if (!confirmation.ok) {
        setStatus("Position not confirmed", confirmation.message, "warning");
        return;
      }
      observation = confirmation.recognition;
      pendingRecognition = observation;
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
      emitChessVoiceContext("tracking");
    } catch (error) {
      setStatus("Couldn’t start tracking", error && error.message ? error.message : "Try again with the full board in view.", "warning");
    } finally {
      scanning = false;
      trackButton.disabled = false;
      suggestButton.disabled = false;
    }
  }

  async function suggestMove(options = {}) {
    const automatic = options.automatic === true;
    if (suggestButton.disabled && !automatic) return;
    if (automatic && (!autoEnabled || !gameState || !isPlayersTurn(gameState))) return;
    let fen;
    let sideToMove;
    suggestButton.disabled = true;
    try {
      if (gameState && !pendingRecognition) {
        fen = gameState.currentFen;
        sideToMove = new Chess(fen).turn();
      } else {
        if (!pendingRecognition || !selectedSide) {
          suggestButton.disabled = false;
          return;
        }
        const firstRecognition = pendingRecognition;
        const confirmation = await getConfirmedRecognition(firstRecognition);
        if (!confirmation.ok) {
          popup.dataset.kind = "warning";
          popupTitle.textContent = "Next strong move";
          popupMessage.textContent = confirmation.message || "I couldn't confirm the board. Keep all 64 squares visible and try again.";
          suggestButton.textContent = "Try again";
          suggestButton.disabled = false;
          return;
        }

        pendingRecognition = confirmation.recognition;
        pendingRecognitionConfirmation = null;
        const placement = placementFromRows(pendingRecognition.boardRows);
        const userColor = inferUserColorFromOrientation(pendingRecognition.orientation) || "w";
        // White moves first in a new game. For a photographed mid-game position,
        // default to the color on the near edge instead of asking a setup question.
        const requestedTurn = placement === INITIAL_POSITION ? "w" : (selectedSide || userColor);
        const position = boardRowsToFen(pendingRecognition.boardRows, requestedTurn);
        if (!position.ok) {
          popup.dataset.kind = "warning";
          popupTitle.textContent = "Next strong move";
          popupMessage.textContent = position.message;
          suggestButton.textContent = "Try again";
          suggestButton.disabled = false;
          return;
        }

        // The first confirmed suggestion implicitly starts tracking. This keeps
        // later scans aligned with the current FEN instead of re-seeding each turn.
        if (placement === INITIAL_POSITION && requestedTurn === "w") {
          gameState = createNewChessGame({ playerColor: userColor, now: nowIso() });
          gameState.lastBoardRows = pendingRecognition.boardRows.slice();
          gameState.lastOrientation = pendingRecognition.orientation;
          gameState.lastObservationAt = nowIso();
          gameState.updatedAt = nowIso();
        } else {
          const seeded = createSeed(pendingRecognition, requestedTurn, userColor);
          if (!seeded.ok) {
            popup.dataset.kind = "warning";
            popupTitle.textContent = "Next strong move";
            popupMessage.textContent = seeded.message || "I couldn't validate this position. Scan the board again.";
            suggestButton.textContent = "Try again";
            suggestButton.disabled = false;
            return;
          }
          gameState = seeded.state;
        }
        persistGame();
        fen = gameState.currentFen;
        sideToMove = new Chess(fen).turn();
        pendingRecognition = null;
      }
    } catch (error) {
      popup.dataset.kind = "warning";
      popupTitle.textContent = "Next strong move";
      popupMessage.textContent = error && error.message ? error.message : "Try scanning the board again.";
      suggestButton.textContent = "Try again";
      suggestButton.disabled = false;
      return;
    }

    if (gameState && !isPlayersTurn(gameState)) {
      showWaitingForUserTurn(new Chess(gameState.currentFen).turn());
      return;
    }

    trackButton.disabled = true;
    popupTitle.textContent = "Next strong move";
    popupMessage.textContent = "Checking the confirmed position with Stockfish…";
    const sequence = ++analysisSequence;
    try {
      const analysis = await getEngine().analyzePosition(fen, { movetimeMs: 1200 });
      if (sequence !== analysisSequence) return;
      lastSuggestedFen = fen;
      pendingMode = "message";
      popup.dataset.kind = analysis.bestMove ? "success" : "warning";
      if (!analysis.bestMove) {
        popupMessage.textContent = analysis.status === "checkmate" ? "This position is checkmate. There is no legal move." : analysis.status === "stalemate" ? "This position is stalemate. There is no legal move." : "There is no legal move to recommend.";
      } else {
        emitChessVoiceContext("analysis", { analysis, fen });
        popupMessage.textContent = colorName(sideToMove) + " to move: " + analysis.bestMove.san + " (" + analysis.bestMove.uci + "). Stockfish’s strongest move for this position.";
      }
      turnSelector.hidden = true;
      suggestButton.hidden = false;
      suggestButton.disabled = false;
      suggestButton.textContent = "Next strong move";
      suggestButton.classList.add("chess-popup-action-primary");
      trackButton.hidden = true;
      dismissButton.textContent = "Not now";
      pendingRecognition = null;
      pendingRecognitionConfirmation = null;
      if (statusMessageTimer) clearTimeout(statusMessageTimer);
      statusMessageTimer = null;
      popup.hidden = false;
      scheduleDetection(BASE_RETRY_MS);
    } catch (error) {
      popupTitle.textContent = "Next strong move";
      popupMessage.textContent = error && error.message ? error.message : "Stockfish couldn't finish this analysis. Tap to try again.";
      popup.dataset.kind = "warning";
      suggestButton.hidden = false;
      suggestButton.disabled = false;
      suggestButton.textContent = "Try again";
      suggestButton.classList.add("chess-popup-action-primary");
      trackButton.hidden = true;
      dismissButton.textContent = "Not now";
      if (statusMessageTimer) clearTimeout(statusMessageTimer);
      statusMessageTimer = null;
    } finally {
      suggestButton.disabled = false;
      trackButton.disabled = false;
    }
  }

  function showTrackedState() {
    if (!gameState) return;
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    statusMessageTimer = null;
    const game = new Chess(gameState.currentFen);
    const yourTurn = isPlayersTurn(gameState);
    pendingMode = yourTurn ? "message" : "waiting";
    popupTitle.textContent = "Next strong move";
    popupMessage.textContent = yourTurn
      ? (lastSuggestedFen === gameState.currentFen
        ? "Your turn (" + colorName(game.turn()) + "). Your latest strong move is ready below."
        : "Your turn (" + colorName(game.turn()) + "). Finding your next strong move…")
      : colorName(game.turn()) + " to move. I'll calculate your next strong move automatically when it's your turn (" +
        colorName(gameState.playerColor) + ").";
    popup.dataset.kind = yourTurn ? "success" : "info";
    turnSelector.hidden = true;
    suggestButton.hidden = false;
    suggestButton.disabled = !yourTurn || (autoEnabled && lastSuggestedFen !== gameState.currentFen);
    suggestButton.textContent = "Next strong move";
    suggestButton.classList.add("chess-popup-action-primary");
    trackButton.hidden = true;
    dismissButton.textContent = "Not now";
    popup.hidden = false;
    scheduleDetection(BASE_RETRY_MS);
    if (yourTurn) queueAutomaticRecommendation();
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
