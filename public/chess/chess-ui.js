import { Chess } from "./chess.js";
import { StockfishChessEngine } from "./engine-client.js?v=0.4.146";
import { recognizeChessboardFrame, boardRowsToFen, validateBoardRows, verifyStableChessboardRecognition, inferUserColorFromOrientation, computeCoverCrop } from "./recognition-client.js?v=0.4.145";
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
  const pauseButton = $("#chessPauseDetection");
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

  if (!launch || !popup || !popupTitle || !popupMessage || !pauseButton || !video) return;

  let engine = null;
  let gameState = null;
  let pendingRecognition = null;
  let pendingMode = "hidden";
  let selectedSide = null;
  let scanning = false;
  let confirmationInProgress = false;
  let manualScanRequested = false;
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
  let analysisInProgress = false;

  function loadAutoSetting() {
    try {
      const saved = localStorage.getItem(AUTO_KEY);
      return saved === null ? true : saved === "on";
    } catch {
      return true;
    }
  }

  function setStatus(title, message, kind = "info", persistUntilResult = false) {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    popupTitle.textContent = title;
    popupMessage.textContent = message;
    popup.dataset.kind = kind;
    setPopupOpen(true);
    pendingMode = "message";
    turnSelector.hidden = true;
    suggestButton.hidden = true;
    trackButton.hidden = true;
    dismissButton.textContent = "Done";
    statusMessageTimer = persistUntilResult ? null : setTimeout(() => {
      if (pendingMode === "message") hidePopup(gameState ? BASE_RETRY_MS : DISMISS_COOLDOWN_MS);
    }, 9000);
  }

  function updateAutoControl() {
    launch.classList.toggle("chess-autodetect-active", autoEnabled);
    launch.classList.toggle("chess-autodetect-paused", !autoEnabled);
    launch.setAttribute("aria-label", autoEnabled
      ? "Open chess assistant. Automatic board detection is active; tap to open Next strong move."
      : "Open chess assistant. Automatic board detection is paused; tap to open the panel and resume.");
    launch.setAttribute("aria-haspopup", "dialog");
    launch.setAttribute("aria-controls", "chessDetectionPopup");
    launch.setAttribute("aria-expanded", String(!popup.hidden));
    launch.title = autoEnabled
      ? "Chess assistant · open Next strong move · automatic scan active"
      : "Chess assistant · open Next strong move · automatic scan paused";
    pauseButton.textContent = autoEnabled ? "Pause automatic scan" : "Resume automatic scan";
    pauseButton.setAttribute("aria-pressed", String(autoEnabled));
  }

  function setPopupOpen(open) {
    popup.hidden = !open;
    launch.setAttribute("aria-expanded", String(open));
  }

  function hidePopup(nextDelay = DISMISS_COOLDOWN_MS) {
    if (statusMessageTimer) clearTimeout(statusMessageTimer);
    statusMessageTimer = null;
    setPopupOpen(false);
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
    selectedSide = pendingMode === "recover" ? null : (options.sideToMove || (knownStart ? "w" : userColor));
    popupMessage.textContent = options.message || (knownStart
      ? "Chess detected. " + colorName(userColor) + " is your side; White moves first."
      : "Chess detected. Near side is " + colorName(userColor) + ". I’ll use that as your default color.");
    setPopupOpen(true);
    dismissButton.textContent = "Not now";
    turnSelector.hidden = pendingMode !== "recover";
    whiteTurn.setAttribute("aria-pressed", String(selectedSide === "w"));
    blackTurn.setAttribute("aria-pressed", String(selectedSide === "b"));
    suggestButton.hidden = false;
    suggestButton.disabled = pendingMode === "recover";
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
    setPopupOpen(true);

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
    setPopupOpen(true);
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
      if (scanning || analysisInProgress) {
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
    if (!engine) engine = new StockfishChessEngine({ defaultMoveTimeMs: 4500, searchTimeoutMs: 18000 });
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
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const style = window.getComputedStyle(video);
    let crop = { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
    if (style.objectFit === "cover") {
      const boxWidth = video.clientWidth || video.offsetWidth || sourceWidth;
      const boxHeight = video.clientHeight || video.offsetHeight || sourceHeight;
      let zoomX = 1;
      let zoomY = 1;
      if (style.transform && style.transform !== "none" && typeof DOMMatrixReadOnly !== "undefined") {
        try {
          const matrix = new DOMMatrixReadOnly(style.transform);
          zoomX = Math.hypot(matrix.a, matrix.b) || 1;
          zoomY = Math.hypot(matrix.c, matrix.d) || 1;
        } catch {}
      }
      crop = computeCoverCrop(sourceWidth, sourceHeight, boxWidth, boxHeight, style.objectPosition, zoomX, zoomY);
    }
    // Match the actual visible preview rather than uploading the uncropped camera
    // sensor frame. This is crucial when a portrait UI crops a landscape sensor.
    let width = Math.max(1, Math.round(crop.sw));
    let height = Math.max(1, Math.round(crop.sh));
    const scale = Math.min(1, 1120 / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare a chess scan.");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
      for (const quality of [0.66, 0.56, 0.46, 0.36, 0.28]) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.type === "image/jpeg" && blob.size >= 4 && blob.size <= MAX_FRAME_BYTES) return blob;
      }
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
    throw new Error("Move a little farther back and try again.");
  }

  async function recognizeOneFrame(options = {}) {
    const readOnce = async () => {
      const frame = await captureSingleFrame();
      const result = await recognizeChessboardFrame(frame);
      lastRecognitionCompletedAt = Date.now();
      return result;
    };

    let result = await readOnce();
    if (result.ok || options.retryOnFailure !== true) return result;

    // Fast path: never spend a second model request confirming a valid board.
    // Only take one fresh-frame retry if the first provider read was unusable.
    await new Promise((resolve) => setTimeout(resolve, 950));
    result = await readOnce();
    if (result.ok) return result;
    return {
      ...result,
      message: "I couldn't read the board after two quick attempts. Keep the full 8×8 board and all four corners visible, then tap Try again. " +
        String(result.message || "Make sure the pieces are clearly visible.")
    };
  }

  function validateRecognitionCandidate(recognition) {
    if (!recognition || !Array.isArray(recognition.boardRows) ||
        !Array.isArray(recognition.boardCornersNormalized) ||
        recognition.boardCornersNormalized.length !== 4 ||
        !["white_at_bottom", "black_at_bottom"].includes(recognition.orientation)) {
      return {
        ok: false,
        reason: "invalid_recognition_candidate",
        message: "The board reading is incomplete. Keep all four corners visible and scan again."
      };
    }
    const board = validateBoardRows(recognition.boardRows);
    return board.ok ? { ok: true, recognition } : board;
  }

  function startBackgroundConfirmation(recognition) {
    const placement = placementFromRows(recognition && recognition.boardRows);
    if (!placement) return Promise.resolve({
      ok: false,
      reason: "invalid_recognition_candidate",
      message: "The board reading is incomplete. Show the whole 8×8 grid and try again."
    });
    if (pendingRecognitionConfirmation && pendingRecognitionConfirmation.placement === placement) {
      return pendingRecognitionConfirmation.promise;
    }

    const entry = { placement, promise: null, result: null };
    entry.promise = (async () => {
      const first = validateRecognitionCandidate(recognition);
      if (!first.ok) return first;

      // New/untracked positions get an independent second camera read. Tracked
      // turns stay on the fast path and must reconcile to legal move history.
      confirmationInProgress = true;
      try {
        const second = await recognizeOneFrame();
        const stable = verifyStableChessboardRecognition(first, second);
        if (!stable.ok) return stable;
        return validateRecognitionCandidate(stable.recognition);
      } catch (error) {
        return {
          ok: false,
          reason: "confirmation_scan_failed",
          message: error && error.message
            ? error.message
            : "I couldn't independently confirm this board. Keep it steady and try again."
        };
      } finally {
        confirmationInProgress = false;
      }
    })().then((result) => {
      entry.result = result;
      if (result.ok && pendingRecognition && placementFromRows(pendingRecognition.boardRows) === placement) {
        pendingRecognition = result.recognition;
      }
      if (!result.ok && pendingRecognition && placementFromRows(pendingRecognition.boardRows) === placement) {
        popup.dataset.kind = "warning";
      }
      return result;
    });
    pendingRecognitionConfirmation = entry;
    return entry.promise;
  }

  async function getConfirmedRecognition(recognition) {
    const placement = placementFromRows(recognition && recognition.boardRows);
    const entry = pendingRecognitionConfirmation && pendingRecognitionConfirmation.placement === placement
      ? pendingRecognitionConfirmation
      : null;
    if (entry) {
      const result = await entry.promise;
      if (result.ok) return result;
      // After disagreement, refresh the candidate before trying a new pair.
      if (pendingRecognitionConfirmation === entry) pendingRecognitionConfirmation = null;
      const fresh = await recognizeOneFrame({ retryOnFailure: true });
      if (!fresh.ok) return fresh;
      pendingRecognition = fresh.recognition;
      return startBackgroundConfirmation(fresh.recognition);
    }
    return startBackgroundConfirmation(recognition);
  }


  function scheduleDetection(delay = BASE_RETRY_MS) {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    if (!autoEnabled) return;
    autoTimer = setTimeout(() => { void detectChessboard(); }, delay);
  }

  function reconcileObservationAgainstTrackedState(observation) {
    if (!gameState) return { ok: false, reason: "game_state_unavailable", message: "The tracked game is no longer available." };
    const currentGame = new Chess(gameState.currentFen);
    const currentPlacement = currentGame.fen().split(" ")[0];
    const placement = placementFromRows(observation && observation.boardRows);
    const payload = {
      boardRows: observation.boardRows,
      orientation: observation.orientation,
      sideToMove: placement === currentPlacement ? currentGame.turn() : opposite(currentGame.turn()),
      observedAt: nowIso()
    };
    let reconciled = reconcileChessObservation(gameState, payload);
    if (!reconciled.ok && placement !== currentPlacement &&
        reconciled.reason === "transition_not_one_or_two_legal_moves") {
      // The user's move and the opponent's reply may both happen between scans.
      reconciled = reconcileChessObservation(gameState, { ...payload, sideToMove: currentGame.turn() });
    }
    return reconciled;
  }

  async function refreshTrackedPositionFromCamera() {
    if (!gameState) return null;
    const idleDeadline = Date.now() + 15000;
    while ((scanning || confirmationInProgress) && Date.now() < idleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (scanning || confirmationInProgress) throw new Error("The camera is still checking the board. Wait a moment and tap Next move again.");
    if (!cameraIsActive()) throw new Error("Keep the full chessboard visible in the camera. I need a fresh board reading before suggesting another move.");
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }

    scanning = true;
    try {
      const firstRead = await recognizeOneFrame({ retryOnFailure: true });
      if (!firstRead.ok) throw new Error(firstRead.message || "I couldn't read the current board. Keep all 64 squares visible and try again.");
      const confirmation = await validateRecognitionCandidate(firstRead.recognition);
      if (!confirmation.ok) throw new Error(confirmation.message || "I couldn't confirm the current board. Keep it still and try again.");

      const observation = confirmation.recognition;
      const reconciled = reconcileObservationAgainstTrackedState(observation);
      if (!reconciled.ok) {
        if (["transition_not_one_or_two_legal_moves", "ambiguous_transition"].includes(reconciled.reason)) {
          const placement = placementFromRows(observation.boardRows);
          pendingRecognition = observation;
          const confirmed = { ok: true, recognition: observation };
          pendingRecognitionConfirmation = { placement, result: confirmed, promise: Promise.resolve(confirmed) };
          showBoardPrompt(observation, {
            mode: "recover",
            message: "The board has moved beyond the last confirmed position. To avoid repeating a stale move, confirm whose turn it is now, then tap Next strong move."
          });
          return { recoveryRequired: true };
        }
        throw new Error(reconciled.message || "I couldn't reconcile the current board.");
      }

      gameState = reconciled.state;
      persistGame();
      pendingRecognition = null;
      pendingRecognitionConfirmation = null;
      return reconciled;
    } finally {
      scanning = false;
      scheduleDetection(BASE_RETRY_MS);
    }
  }

  async function detectChessboard(manual = false) {
    if (!autoEnabled && !manual) return;
    if (confirmationInProgress) {
      if (manual) manualScanRequested = true;
      scheduleDetection(BASE_RETRY_MS);
      return;
    }
    if (!manual && !gameState && pendingRecognition && !popup.hidden) {
      scheduleDetection(MAX_RETRY_MS);
      return;
    }
    if (scanning) {
      if (manual) manualScanRequested = true;
      scheduleDetection(BASE_RETRY_MS);
      return;
    }
    if (!cameraIsActive()) {
      scheduleDetection(1800);
      return;
    }
    scanning = true;
    try {
      const result = await recognizeOneFrame({ retryOnFailure: manual });
      if (!result.ok) {
        consecutiveMisses += 1;
        const shouldReportManualFailure = manual || manualScanRequested;
        manualScanRequested = false;
        if (shouldReportManualFailure) {
          setStatus("Couldn’t read the board", result.message || "I couldn’t read the 8×8 grid. Keep the full board visible and try again.", "warning");
        }
        scheduleDetection(Math.min(MAX_RETRY_MS, BASE_RETRY_MS + consecutiveMisses * 1500));
        return;
      }
      manualScanRequested = false;
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
        const confirmation = await validateRecognitionCandidate(observation);
        if (!confirmation.ok) {
          setStatus("Couldn’t confirm the position", confirmation.message, "warning");
          scheduleDetection(BASE_RETRY_MS);
          return;
        }
        observation = confirmation.recognition;
        placement = placementFromRows(observation.boardRows);
        if (!placement) {
          setStatus("Couldn’t confirm the position", "The second board reading was incomplete. Keep all four corners visible and scan again.", "warning");
          return;
        }
        const reconciled = reconcileObservationAgainstTrackedState(observation);
        if (reconciled.ok && ["move-registered", "moves-registered"].includes(reconciled.status)) {
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
          message: "The board has moved beyond the last confirmed position. Confirm whose turn it is, then tap Next strong move."
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
      const shouldReportManualFailure = manual || manualScanRequested;
      manualScanRequested = false;
      if (shouldReportManualFailure) setStatus("Chess detection unavailable", error && error.message ? error.message : "Try again when the camera is clear.", "warning");
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
      const confirmation = await getConfirmedRecognition(observation);
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
      if (gameState && !pendingRecognition && !automatic) {
        const refreshed = await refreshTrackedPositionFromCamera();
        if (refreshed && refreshed.recoveryRequired) return;
        if (!gameState) throw new Error("The tracked chess position is no longer available.");
        if (!isPlayersTurn(gameState)) {
          showWaitingForUserTurn(new Chess(gameState.currentFen).turn());
          return;
        }
        if (lastSuggestedFen === gameState.currentFen) {
          popup.dataset.kind = "warning";
          popupTitle.textContent = "Next strong move";
          popupMessage.textContent = "I still see the same board position as the last suggestion. Make sure your move is visible on the camera, then tap Next strong move again.";
          suggestButton.textContent = "Try again";
          suggestButton.disabled = false;
          return;
        }
      }

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
    const chessEngine = getEngine();
    popupMessage.textContent = chessEngine.enginePhase === "ready"
      ? "Searching the confirmed position with Stockfish 19 Full…"
      : "First use downloads the full-strength Stockfish 19 engine (~90 MB, cached for future moves), then searches the confirmed position…";
    const sequence = ++analysisSequence;
    analysisInProgress = true;
    try {
      const analysis = await chessEngine.analyzePosition(fen, { movetimeMs: 4500 });
      if (sequence !== analysisSequence) return;
      lastSuggestedFen = fen;
      pendingMode = "message";
      popup.dataset.kind = analysis.bestMove ? "success" : "warning";
      if (!analysis.bestMove) {
        popupMessage.textContent = analysis.status === "checkmate" ? "This position is checkmate. There is no legal move." : analysis.status === "stalemate" ? "This position is stalemate. There is no legal move." : "There is no legal move to recommend.";
      } else {
        emitChessVoiceContext("analysis", { analysis, fen });
        popupMessage.textContent = colorName(sideToMove) + " to move: " + analysis.bestMove.san + " (" + analysis.bestMove.uci + "). Stockfish 19 Full · depth " + (analysis.analysis && analysis.analysis.depth || "—") + ".";
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
      setPopupOpen(true);
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
      analysisInProgress = false;
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
    setPopupOpen(true);
    scheduleDetection(BASE_RETRY_MS);
    if (yourTurn) queueAutomaticRecommendation();
  }

  launch.addEventListener("click", () => {
    // The horse icon is the main entry point, not a hidden pause switch.
    // Always open the panel and resume automatic detection on an intentional tap.
    dismissedPlacement = null;
    dismissedUntil = 0;
    setAutoEnabled(true);
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    if (gameState) {
      showTrackedState();
      popupMessage.textContent = "Checking the live board before calculating your next strong move…";
      void refreshTrackedPositionFromCamera().then((refreshed) => {
        if (refreshed && refreshed.recoveryRequired) return;
        if (!gameState) return;
        const sideToMove = new Chess(gameState.currentFen).turn();
        if (!isPlayersTurn(gameState)) {
          showWaitingForUserTurn(sideToMove);
          return;
        }
        if (lastSuggestedFen === gameState.currentFen) {
          popup.dataset.kind = "warning";
          popupMessage.textContent = "I still see the previous board position. Make sure your move is visible in the camera, then tap Next move again.";
          return;
        }
        queueAutomaticRecommendation();
      }).catch((error) => {
        setStatus("Couldn't refresh the board", error && error.message ? error.message : "Keep the full board visible and try again.", "warning");
      });
      return;
    }
    if (pendingRecognition) {
      showBoardPrompt(pendingRecognition);
      return;
    }
    const cameraReady = cameraIsActive();
    setStatus("Next strong move", cameraReady
      ? "Scanning the visible camera frame for the 8×8 board. Digital boards such as Chess.com are supported; your default side is the edge nearest the bottom of the preview."
      : "Chess assistant is ready. Start the camera, then point it at the full chessboard. Your default side is the edge nearest the bottom of the preview.", "info", cameraReady);
    void detectChessboard(true);
  });
  pauseButton.addEventListener("click", () => {
    setAutoEnabled(!autoEnabled);
    if (gameState) {
      showTrackedState();
      return;
    }
    if (pendingRecognition) {
      showBoardPrompt(pendingRecognition);
      return;
    }
    setStatus("Next strong move", autoEnabled
      ? "Automatic board scanning is on. Keep the full chessboard in view. Tap Pause automatic scan any time."
      : "Automatic board scanning is paused. Tap Resume automatic scan when you want me to look again.");
  });
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
