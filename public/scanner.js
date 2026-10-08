const video = document.getElementById("video");
const sampleImage = document.getElementById("sampleImage");
const overlay = document.getElementById("overlay");
const ctxOverlay = overlay.getContext("2d");
const videoWrapper = document.getElementById("video-wrapper");
const captureBtn = document.getElementById("captureBtn");
const loader = document.getElementById("loader");
const loaderStatus = document.getElementById("loader-status");
const loadingText = document.getElementById("opencv-loading");

// --- KI-Kantenerkennung State ---
let onnxSession = null;
let onnxLoading = false;
let onnxReady = false;
let onnxLoadFailed = false;
let openCvReady = false; // Wird für Perspektivtransformation / Entzerrung beim Speichern genutzt
let cameraStarted = false;

// Bildquelle (Live Kamera oder Test-Bilder)
const sourceSelect = document.getElementById("sourceSelect");
let activeSource = "camera";

// Debug-Modus: sourceSelect nur sichtbar bei ?debug in der URL
const isDebugMode = new URLSearchParams(window.location.search).has("debug");
if (isDebugMode && sourceSelect) {
  sourceSelect.style.display = "";
  console.log("[Scanner] Debug-Modus aktiv: Testbild-Auswahl sichtbar");
}

// UI-Slider Handler
let onnxSensitivity = 0.85;

const sensitivitySlider = document.getElementById("sensitivitySlider");
if (sensitivitySlider) {
  sensitivitySlider.value = 85;
  const sensVal = document.getElementById("sensitivityVal");
  if (sensVal) sensVal.innerText = "85%";
  sensitivitySlider.oninput = function () {
    let s = parseInt(this.value);
    if (sensVal) sensVal.innerText = s + "%";
    onnxSensitivity = s / 100.0;
  };
}

const smoothingSlider = document.getElementById("smoothingSlider");
// SMOOTHING_INERTIA: 0.0 (direkt/schnell) bis 1.0 (hohe Trägheit)
let SMOOTHING_INERTIA = 0.40; // 40% als idealer, reaktionsschneller Standard

if (smoothingSlider) {
  smoothingSlider.value = 40;
  const smoothingVal = document.getElementById("smoothingVal");
  if (smoothingVal) smoothingVal.innerText = "40%";
  smoothingSlider.oninput = function () {
    SMOOTHING_INERTIA = parseInt(this.value) / 100.0;
    if (smoothingVal) smoothingVal.innerText = this.value + "%";
  };
}

let swapAfAxes = localStorage.getItem("scanner_swap_af_axes") !== "false"; // Standard: true (X <-> Y Tausch für Smartphone-Portrait)
const swapAfAxesToggle = document.getElementById("swapAfAxesToggle") || document.getElementById("invertAfToggle");
if (swapAfAxesToggle) {
  swapAfAxesToggle.checked = swapAfAxes;
  swapAfAxesToggle.onchange = function () {
    swapAfAxes = this.checked;
    localStorage.setItem("scanner_swap_af_axes", swapAfAxes ? "true" : "false");
    console.log(`[Fokus] AF-Achsentausch (X <-> Y) gesetzt auf: ${swapAfAxes}`);
  };
}

let streaming = false;

// Dedicated 256x256 working canvas for ONNX inference
const canvasOnnx = document.createElement("canvas");
canvasOnnx.width = 256;
canvasOnnx.height = 256;
const ctxOnnx = canvasOnnx.getContext("2d", { willReadFrequently: true });
const onnxTensorBuffer = new Float32Array(3 * 256 * 256);
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

let currentRelativeDocumentCorners = null;

let smoothedCornersRaw = null;
let framesWithoutDetection = 0;
const MAX_FRAMES_LOSE_TRACK = 12;

// Hilfsfunktion, um die 4 Punkte in eine verlässliche Form zu Sortieren (Top-Left, Top-Right, Bottom-Right, Bottom-Left).
// Verwendet die robuste Summen- & Differenz-Methode (OpenCV order_points), um ein Überkreuzen/Verdrehen der Ecken zu verhindern.
function sortAndOrderCorners(ptsData) {
  let pts = [];
  if (Array.isArray(ptsData) && typeof ptsData[0] === "object") {
    pts = ptsData.map((p) => ({ x: p.x, y: p.y }));
  } else {
    for (let i = 0; i < 4; i++) {
      pts.push({ x: ptsData[i * 2], y: ptsData[i * 2 + 1] });
    }
  }
  if (pts.length !== 4) return pts;

  // 1. Primär: Robuste 4-Punkte-Zuordnung über Summe & Differenz (OpenCV-Standard)
  // Top-Left: minimale Summe (x + y)
  // Bottom-Right: maximale Summe (x + y)
  // Top-Right: minimale Differenz (y - x) bzw. maximale Differenz (x - y)
  // Bottom-Left: maximale Differenz (y - x) bzw. minimale Differenz (x - y)
  let tl = pts[0], br = pts[0], tr = pts[0], bl = pts[0];
  let minSum = Infinity, maxSum = -Infinity;
  let minDiff = Infinity, maxDiff = -Infinity;

  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const sum = p.x + p.y;
    const diff = p.y - p.x;

    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      tr = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      bl = p;
    }
  }

  const assigned = [tl, tr, br, bl];
  if (new Set(assigned).size === 4) {
    return assigned;
  }

  // 2. Fallback für extreme Drehungen: Zyklisch im Uhrzeigersinn sortieren,
  // startend bei der Ecke, die (0, 0) am nächsten liegt.
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

  const sortedClockwise = pts.slice().sort((a, b) => {
    return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
  });

  let bestTlIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = sortedClockwise[i].x * sortedClockwise[i].x + sortedClockwise[i].y * sortedClockwise[i].y;
    if (d < bestDist) {
      bestDist = d;
      bestTlIdx = i;
    }
  }

  return [
    sortedClockwise[bestTlIdx],
    sortedClockwise[(bestTlIdx + 1) % 4],
    sortedClockwise[(bestTlIdx + 2) % 4],
    sortedClockwise[(bestTlIdx + 3) % 4],
  ];
}

// Plausibilitäts- & Geometrieprüfung für Dokumente:
// Verhindert komplett verzerrte Trapeze, spitze Dreiecke, Strichformen und unplausible Vierecke
function isPlausibleDocumentShape(pts) {
  if (!pts || pts.length !== 4) return false;

  // 1. Mindest- und Maximalfläche (Shoelace formula)
  const area =
    0.5 *
    Math.abs(
      pts[0].x * (pts[1].y - pts[3].y) +
      pts[1].x * (pts[2].y - pts[0].y) +
      pts[2].x * (pts[3].y - pts[1].y) +
      pts[3].x * (pts[0].y - pts[2].y)
    );
  if (area < 0.02 || area > 0.98) return false;

  // 2. Kantenlängen berechnen
  const d01 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const d12 = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
  const d23 = Math.hypot(pts[3].x - pts[2].x, pts[3].y - pts[2].y);
  const d30 = Math.hypot(pts[0].x - pts[3].x, pts[0].y - pts[3].y);

  // Keine extrem winzigen Kanten (< 3% der Bildbreite)
  if (Math.min(d01, d12, d23, d30) < 0.03) return false;

  // 3. Verhältnis gegenüberliegender Kanten (nur moderate perspektivische Verzerrung erlauben)
  const ratio02 = Math.max(d01, d23) / (Math.min(d01, d23) + 1e-6);
  const ratio13 = Math.max(d12, d30) / (Math.min(d12, d30) + 1e-6);
  if (ratio02 > 2.5 || ratio13 > 2.5) return false;

  // 4. Seitenverhältnis (Aspect Ratio) prüfen (nicht extremer als ca. 1:7 für Kassenbons)
  const avgW = (d01 + d23) / 2;
  const avgH = (d12 + d30) / 2;
  const aspectRatio = Math.min(avgW, avgH) / (Math.max(avgW, avgH) + 1e-6);
  if (aspectRatio < 0.14) return false;

  // 5. Innenwinkel an allen 4 Ecken prüfen und Konvexitäts-Vorzeichen prüfen
  let firstCrossSign = 0;
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const curr = pts[i];
    const next = pts[(i + 1) % 4];

    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-5 || len2 < 1e-5) return false;

    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    // |cos(angle)| < 0.77 (ca. 40° bis 140°)
    if (Math.abs(dot) > 0.77) return false;

    // Kreuzprodukt: Alle Ecken müssen im Uhrzeigersinn die gleiche Drehrichtung haben
    const cross = v1x * v2y - v1y * v2x;
    if (Math.abs(cross) < 1e-5) return false;
    const sign = cross > 0 ? 1 : -1;
    if (firstCrossSign === 0) {
      firstCrossSign = sign;
    } else if (sign !== firstCrossSign) {
      return false; // Vorzeichenwechsel = Überkreuzung oder Einbuchtung
    }
  }

  return true;
}

// Corner Alignment / Nearest-Neighbor Association:
// Verknüpft die neuen 4 Ecken mit den direkten Vorgängerecken (verhindert Eckentausch bei Drehungen)
function alignCornersWithPrevious(newCorners, prevCorners) {
  if (!prevCorners || prevCorners.length !== 4) return newCorners;

  let bestPerm = newCorners;
  let minTotalDist = Infinity;

  for (let shift = 0; shift < 4; shift++) {
    const perm = [
      newCorners[shift % 4],
      newCorners[(shift + 1) % 4],
      newCorners[(shift + 2) % 4],
      newCorners[(shift + 3) % 4],
    ];

    let totalDist = 0;
    for (let i = 0; i < 4; i++) {
      const dx = perm[i].x - prevCorners[i].x;
      const dy = perm[i].y - prevCorners[i].y;
      totalDist += Math.hypot(dx, dy);
    }

    if (totalDist < minTotalDist) {
      minTotalDist = totalDist;
      bestPerm = perm;
    }
  }

  return bestPerm;
}

// Sprung-Begrenzung & Ausreißer-Schutz:
// Kappt nur unplausible extreme Einzel-Teleports (z.B. Schatten), lässt aber reale Handbewegungen ungebremst durch
function filterAndClampJumps(targetCorners, newCorners) {
  if (!targetCorners || targetCorners.length !== 4) return newCorners;

  const alignedNew = alignCornersWithPrevious(newCorners, targetCorners);
  const dists = [];
  for (let i = 0; i < 4; i++) {
    dists.push(Math.hypot(alignedNew[i].x - targetCorners[i].x, alignedNew[i].y - targetCorners[i].y));
  }

  const avgDist = dists.reduce((a, b) => a + b, 0) / 4;
  const maxAllowedJump = Math.max(0.18, avgDist * 3.0);

  const clamped = [];
  for (let i = 0; i < 4; i++) {
    const curr = targetCorners[i];
    const next = alignedNew[i];
    const d = dists[i];

    if (d > maxAllowedJump) {
      const scale = maxAllowedJump / d;
      clamped.push({
        x: curr.x + (next.x - curr.x) * scale,
        y: curr.y + (next.y - curr.y) * scale,
      });
    } else {
      clamped.push({ x: next.x, y: next.y });
    }
  }

  return clamped;
}

// Schnelles, reaktionsschnelles adaptives Smoothing:
// Bei Stillstand ruhig und jitter-frei, bei Bewegung folgt der Rahmen sofort ohne Nachziehen
function applyAdaptiveSmoothing(targetCorners, newCorners, inertia) {
  if (!targetCorners) {
    return newCorners.map((p) => ({ x: p.x, y: p.y }));
  }

  const clampedNew = filterAndClampJumps(targetCorners, newCorners);
  const result = [];

  for (let i = 0; i < 4; i++) {
    const curr = targetCorners[i];
    const next = clampedNew[i];
    const dist = Math.hypot(next.x - curr.x, next.y - curr.y);

    // Adaptive Reaktionsrate (alpha):
    // - Kleiner Jitter bei Stillstand (dist < 0.003 / 0.3%): Dämpft Mikrozuckungen
    // - Normale Bewegung (dist >= 0.003 .. 0.025): Schnelle, flüssige Mitführung (alpha 0.50 .. 0.90)
    // - Schwenks & schnelle Bewegung (dist > 0.025): Sofortiges Folgen ohne Verzögerung (alpha = 0.98)
    let dynamicAlpha;
    if (dist < 0.003) {
      dynamicAlpha = 0.12 * (1 - inertia * 0.70);
    } else if (dist > 0.025) {
      dynamicAlpha = 0.98;
    } else {
      const progress = (dist - 0.003) / 0.022; // 0.0 .. 1.0
      const baseAlpha = 0.45 + 0.50 * progress;
      dynamicAlpha = baseAlpha * (1 - inertia * 0.40);
    }

    dynamicAlpha = Math.max(0.04, Math.min(1.0, dynamicAlpha));

    result.push({
      x: curr.x * (1 - dynamicAlpha) + next.x * dynamicAlpha,
      y: curr.y * (1 - dynamicAlpha) + next.y * dynamicAlpha,
    });
  }

  return result;
}

// --- ONNX Corner Detection mit Gauß-gewichteter Subpixel-Interpolation ---
function extractCornersFromHeatmap(heatmapData, numCorners = 4, mapH = 128, mapW = 128) {
  const corners = [];
  const scores = [];

  for (let c = 0; c < numCorners; c++) {
    const channelOffset = c * mapH * mapW;
    let maxVal = -Infinity;
    let maxIdx = 0;

    for (let i = 0; i < mapH * mapW; i++) {
      const v = heatmapData[channelOffset + i];
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }

    const peakY = Math.floor(maxIdx / mapW);
    const peakX = maxIdx % mapW;

    // Gauß-gewichteter Subpixel-Schwerpunkt (7x7 Fenster um den Peak für stufenlose Positionierung)
    let sumWeight = 0;
    let sumX = 0;
    let sumY = 0;
    const sigma = 1.4;
    const twoSigmaSq = 2 * sigma * sigma;

    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const ny = peakY + dy;
        const nx = peakX + dx;
        if (nx >= 0 && nx < mapW && ny >= 0 && ny < mapH) {
          const rawV = Math.max(0, heatmapData[channelOffset + ny * mapW + nx]);
          const distSq = dx * dx + dy * dy;
          const gWeight = Math.exp(-distSq / twoSigmaSq);
          const w = rawV * gWeight;
          sumWeight += w;
          sumX += nx * w;
          sumY += ny * w;
        }
      }
    }

    const finalX = sumWeight > 0 ? sumX / sumWeight : peakX;
    const finalY = sumWeight > 0 ? sumY / sumWeight : peakY;

    corners.push({
      x: Math.max(0, Math.min(1, finalX / (mapW - 1))),
      y: Math.max(0, Math.min(1, finalY / (mapH - 1))),
    });
    scores.push(maxVal);
  }

  return { corners, scores };
}

async function detectCornersOnnx(source, sx = 0, sy = 0, sWidth = null, sHeight = null) {
  if (!onnxSession || !onnxReady) return null;

  try {
    const sw = sWidth || source.videoWidth || source.naturalWidth || source.width;
    const sh = sHeight || source.videoHeight || source.naturalHeight || source.height;

    ctxOnnx.drawImage(source, sx, sy, sw, sh, 0, 0, 256, 256);
    const imageData = ctxOnnx.getImageData(0, 0, 256, 256);
    const data = imageData.data;

    for (let i = 0; i < 256 * 256; i++) {
      const r = data[i * 4] / 255.0;
      const g = data[i * 4 + 1] / 255.0;
      const b = data[i * 4 + 2] / 255.0;

      onnxTensorBuffer[0 * 65536 + i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
      onnxTensorBuffer[1 * 65536 + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
      onnxTensorBuffer[2 * 65536 + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }

    const tensor = new ort.Tensor("float32", onnxTensorBuffer, [1, 3, 256, 256]);
    const results = await onnxSession.run({ img: tensor });
    const heatmap = results.heatmap.data;

    const { corners, scores } = extractCornersFromHeatmap(heatmap, 4, 128, 128);

    const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);

    // Dynamische Schwellwerte basierend auf Sensitivität (onnxSensitivity: 0.1 .. 1.0)
    // Bei 85% Sensitivität: minMean ≈ 0.035, minSingle ≈ 0.008 (sehr empfindlich für schwache Kontraste)
    const minMeanReq = Math.max(0.015, 0.12 - onnxSensitivity * 0.10);
    const minSingleReq = Math.max(0.003, 0.03 - onnxSensitivity * 0.026);

    if (meanScore < minMeanReq || minScore < minSingleReq) {
      return null;
    }

    const sortedPts = sortAndOrderCorners(corners);
    if (!isPlausibleDocumentShape(sortedPts)) {
      return null;
    }

    console.log(`[ONNX] Dokument erkannt ✓ mean=${meanScore.toFixed(3)} min=${minScore.toFixed(3)} (Schwelle: ${minMeanReq.toFixed(3)})`);
    return sortedPts;
  } catch (err) {
    console.error("ONNX Inferenzfehler:", err);
    return null;
  }
}

// Initialisiere ONNX Runtime Web (KI-Kantenerkennung)
async function initOnnx() {
  if (onnxLoading || onnxReady) return;
  onnxLoading = true;

  try {
    if (typeof ort === "undefined") {
      console.warn("ONNX Runtime Web (ort) noch nicht im Window, warte...");
      await new Promise((r) => setTimeout(r, 200));
      if (typeof ort === "undefined") {
        throw new Error("ort library nicht verfügbar");
      }
    }

    ort.env.wasm.wasmPaths = "/vendor/onnx/";
    ort.env.wasm.numThreads = 1;

    console.log("Initialisiere ONNX Dokumenten-Modell (WASM)...");
    onnxSession = await ort.InferenceSession.create("/models/doc_corner_net.onnx", {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    // Warm-up Durchlauf
    const dummy = new Float32Array(3 * 256 * 256).fill(0.5);
    const tensor = new ort.Tensor("float32", dummy, [1, 3, 256, 256]);
    await onnxSession.run({ img: tensor });

    onnxReady = true;
    onnxLoading = false;
    onnxLoadFailed = false;
    console.log("ONNX KI Dokumenten-Erkennung erfolgreich initialisiert!");

    onSystemReady();
  } catch (err) {
    console.error("Fehler beim Laden von ONNX:", err);
    onnxLoading = false;
    onnxReady = false;
    onnxLoadFailed = true;
    onSystemReady();
  }
}

// Global hook für OpenCV Initialisierung (wird für Perspektivtransformation / Entzerrung beim Speichern genutzt)
window.onOpenCvReady = function () {
  window.initOpenCvRuntime();
};

window.initOpenCvRuntime = function () {
  if (openCvReady) return;
  if (typeof cv !== "undefined") {
    if (typeof cv.Mat !== "undefined") {
      console.log("OpenCV für Perspektivtransformation bereit (cv.Mat)");
      openCvReady = true;
    } else {
      cv["onRuntimeInitialized"] = () => {
        console.log("OpenCV für Perspektivtransformation bereit (onRuntimeInitialized)");
        openCvReady = true;
      };
    }
  }
};

// Falls OpenCV bereits geladen ist oder per defer nachgeladen wird:
if (typeof cv !== "undefined") {
  window.initOpenCvRuntime();
} else {
  // Polling-Fallback, falls onload-Event vor Skript-Ausführung gefeuert wurde
  const cvCheckInterval = setInterval(() => {
    if (typeof cv !== "undefined") {
      window.initOpenCvRuntime();
      if (openCvReady) clearInterval(cvCheckInterval);
    }
  }, 100);
}

// --- Autofokus & Tap-to-Focus mit automatischem Fokus-Lock ---
let isFocusLocked = false;
let isTapLocked = false;
let lockedFocusCoords = null; // { x, y } in 0..1
let focusLockTimestamp = 0;
let focusLockDocCenter = null; // { x, y }
let steadyDocFrames = 0;
let lastDocCenterBeforeLock = null;
const focusIndicator = document.getElementById("focusIndicator");

let videoTrack = null;

async function initAutofocus() {
  if (!videoTrack) return;
  isFocusLocked = false;
  isTapLocked = false;
  steadyDocFrames = 0;
  lastDocCenterBeforeLock = null;
  try {
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    if (capabilities.focusMode && capabilities.focusMode.includes("continuous")) {
      await videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      console.log("[Autofokus] Nativer kontinuierlicher Autofokus aktiv");
    }
  } catch (e) {
    console.warn("[Autofokus] Kontinuierlicher Autofokus konnte nicht gesetzt werden:", e);
  }
}

// Berechnet die exakte Darstellungs-Geometrie des ungeschnittenen Videos / Bildes innerhalb des Video-Wrappers (object-fit: contain)
function getVideoRenderBox() {
  const currentSource = activeSource === "camera" ? video : sampleImage;
  const srcW = activeSource === "camera"
    ? (video ? video.videoWidth : 0)
    : (sampleImage ? (sampleImage.naturalWidth || sampleImage.width || 0) : 0);
  const srcH = activeSource === "camera"
    ? (video ? video.videoHeight : 0)
    : (sampleImage ? (sampleImage.naturalHeight || sampleImage.height || 0) : 0);

  if (!videoWrapper) {
    return {
      wrapperWidth: 0,
      wrapperHeight: 0,
      renderedWidth: 0,
      renderedHeight: 0,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      srcW: 0,
      srcH: 0,
    };
  }

  const rect = videoWrapper.getBoundingClientRect();
  const wrapperW = rect.width;
  const wrapperH = rect.height;

  if (!srcW || !srcH || wrapperW <= 0 || wrapperH <= 0) {
    return {
      wrapperWidth: wrapperW,
      wrapperHeight: wrapperH,
      renderedWidth: wrapperW,
      renderedHeight: wrapperH,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      srcW: srcW || wrapperW,
      srcH: srcH || wrapperH,
    };
  }

  // object-fit: contain (voller Sensor- bzw. Kamera-View wird ohne jegliche Rand-Beschneidung dargestellt)
  const scale = Math.min(wrapperW / srcW, wrapperH / srcH);
  const renderedW = srcW * scale;
  const renderedH = srcH * scale;
  const offsetX = (wrapperW - renderedW) / 2;
  const offsetY = (wrapperH - renderedH) / 2;

  return {
    wrapperWidth: wrapperW,
    wrapperHeight: wrapperH,
    renderedWidth: renderedW,
    renderedHeight: renderedH,
    offsetX,
    offsetY,
    scale,
    srcW,
    srcH,
  };
}

// Passt das Zeichen-Overlay (Canvas) pixelgenau an den sichtbaren Video-Ausschnitt an
function updateOverlayGeometry() {
  if (!overlay || !videoWrapper) return;
  const box = getVideoRenderBox();
  if (box.renderedWidth > 0 && box.renderedHeight > 0) {
    const leftPx = `${Math.round(box.offsetX)}px`;
    const topPx = `${Math.round(box.offsetY)}px`;
    const widthPx = `${Math.round(box.renderedWidth)}px`;
    const heightPx = `${Math.round(box.renderedHeight)}px`;

    if (overlay.style.left !== leftPx) overlay.style.left = leftPx;
    if (overlay.style.top !== topPx) overlay.style.top = topPx;
    if (overlay.style.width !== widthPx) overlay.style.width = widthPx;
    if (overlay.style.height !== heightPx) overlay.style.height = heightPx;

    const roundedW = Math.round(box.renderedWidth);
    const roundedH = Math.round(box.renderedHeight);
    if (overlay.width !== roundedW || overlay.height !== roundedH) {
      overlay.width = roundedW;
      overlay.height = roundedH;
    }
  }
}

// Hilfsfunktion: Mappt Bildschirm- bzw. VideoWrapper-Koordinaten (0.0..1.0)
// unter Berücksichtigung von CSS object-fit: contain exakt auf den ungeschnittenen Sensor-Videostream
function mapScreenToVideoCoords(normScreenX, normScreenY) {
  const box = getVideoRenderBox();
  if (box.renderedWidth <= 0 || box.renderedHeight <= 0) {
    return { x: 0.5, y: 0.5 };
  }

  const tapPixelX = normScreenX * box.wrapperWidth;
  const tapPixelY = normScreenY * box.wrapperHeight;

  let targetX = (tapPixelX - box.offsetX) / box.renderedWidth;
  let targetY = (tapPixelY - box.offsetY) / box.renderedHeight;

  targetX = Math.min(Math.max(targetX, 0), 1);
  targetY = Math.min(Math.max(targetY, 0), 1);

  // Auf Smartphones im Hochformat (Portrait) ist der Kamerasensor physisch im Querformat (Landscape) montiert.
  // Das Betriebssystem dreht den Stream für die Anzeige, doch die Web API pointsOfInterest erwartet die Koordinaten im nativen Sensorraum.
  // Dadurch sind die X- und Y-Achsen im Treiber vertauscht (Transposition: Screen X -> Sensor Y, Screen Y -> Sensor X).
  // Durch das Vertauschen von targetX und targetY (X <-> Y) fokussiert die Kamera hardwareseitig an allen 4 Ecken exakt.
  if (swapAfAxes) {
    const temp = targetX;
    targetX = targetY;
    targetY = temp;
  }

  return {
    x: targetX,
    y: targetY,
  };
}

// Fixiert den Fokus einmalig auf das ruhige Motiv bis zur nächsten Bewegung (Sensor-Koordinaten 0..1)
async function lockSteadyFocus(sensorX, sensorY) {
  if (isFocusLocked || !videoTrack) return;
  let targetX = Math.min(Math.max(sensorX, 0), 1);
  let targetY = Math.min(Math.max(sensorY, 0), 1);

  if (swapAfAxes) {
    const temp = targetX;
    targetX = targetY;
    targetY = temp;
  }

  try {
    await videoTrack.applyConstraints({
      advanced: [{ pointsOfInterest: [{ x: targetX, y: targetY }], focusMode: "single-shot" }],
    });
  } catch (_) {
    try {
      await videoTrack.applyConstraints({
        advanced: [{ focusMode: "single-shot" }],
      });
    } catch (_) {
      try {
        await videoTrack.applyConstraints({
          advanced: [{ focusMode: "manual" }],
        });
      } catch (_) {}
    }
  }
  isFocusLocked = true;
  isTapLocked = false;
  focusLockTimestamp = Date.now();
  focusLockDocCenter = { x: sensorX, y: sensorY };
  console.log(`[Fokus] Beleg ruhig im Bild -> Fokus fixiert auf Sensor-Stream (${(targetX * 100).toFixed(0)}%, ${(targetY * 100).toFixed(0)}%)`);
}

async function unlockFocus(reason = "Automatisch") {
  if (!isFocusLocked) return;
  isFocusLocked = false;
  isTapLocked = false;
  lockedFocusCoords = null;
  focusLockDocCenter = null;
  steadyDocFrames = 0;
  lastDocCenterBeforeLock = null;

  if (focusIndicator) {
    focusIndicator.style.display = "none";
  }

  console.log(`[Fokus] Größere Bewegung/Motivwechsel (${reason}) -> Autofokus wieder kontinuierlich`);

  if (videoTrack) {
    try {
      const caps = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
      if (!caps.focusMode || caps.focusMode.includes("continuous")) {
        await videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      }
    } catch (e) {
      console.warn("[Fokus] Zurücksetzen auf continuous fehlgeschlagen:", e);
    }
  }
}

function setupTapToFocus() {
  if (!videoWrapper) return;

  let lastTapTime = 0;

  const handleTap = async (clientX, clientY) => {
    const now = Date.now();
    if (now - lastTapTime < 350) return; // Debounce
    lastTapTime = now;

    if (!videoTrack || activeSource !== "camera") return;

    // Nur im aktiven Sucher tippen, nicht im geöffneten Review-Screen
    const reviewSec = document.getElementById("manual-review-section");
    if (reviewSec && (reviewSec.style.display === "flex" || reviewSec.style.display === "block")) return;

    const rect = videoWrapper.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const tapX = clientX - rect.left;
    const tapY = clientY - rect.top;

    // Relative Koordinaten (0.0 bis 1.0)
    const relX = Math.min(Math.max(tapX / rect.width, 0), 1);
    const relY = Math.min(Math.max(tapY / rect.height, 0), 1);

    // Visuellen Fokus-Lock Indikator anzeigen & animieren
    if (focusIndicator) {
      focusIndicator.style.left = `${tapX}px`;
      focusIndicator.style.top = `${tapY}px`;
      focusIndicator.style.display = "block";
      const box = focusIndicator.querySelector(".focus-box");
      if (box) {
        box.style.animation = "none";
        void box.offsetWidth;
        box.style.animation = "";
      }
    }

    // Haptisches Feedback (sanftes Vibrieren auf Mobilgeräten)
    if (navigator.vibrate) {
      try { navigator.vibrate(40); } catch (_) {}
    }

    const target = mapScreenToVideoCoords(relX, relY);
    console.log(`[Fokus] Angetippt bei Display (${(relX * 100).toFixed(0)}%, ${(relY * 100).toFixed(0)}%) -> Stream (${(target.x * 100).toFixed(0)}%, ${(target.y * 100).toFixed(0)}%)`);

    // Hardware-Kamerasteuerung (Best-effort je nach Smartphone-Treiber)
    const caps = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    console.log("[Fokus] Track Capabilities:", JSON.stringify(caps));

    let applied = false;
    try {
      await videoTrack.applyConstraints({
        advanced: [{ pointsOfInterest: [{ x: target.x, y: target.y }] }],
      });
      applied = true;
    } catch (_) {}

    if (caps.focusMode && caps.focusMode.includes("single-shot")) {
      try {
        await videoTrack.applyConstraints({ advanced: [{ focusMode: "single-shot" }] });
        applied = true;
      } catch (_) {}
    } else if (caps.focusMode && caps.focusMode.includes("continuous")) {
      try {
        await videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      } catch (_) {}
    }

    isFocusLocked = true;
    isTapLocked = true;
    lockedFocusCoords = { x: relX, y: relY };
    focusLockTimestamp = Date.now();

    // Speichere das Dokumentzentrum für Motivwechsel-Prüfung
    if (currentRelativeDocumentCorners && currentRelativeDocumentCorners.length === 4) {
      const avgX = currentRelativeDocumentCorners.reduce((sum, p) => sum + p.x, 0) / 4;
      const avgY = currentRelativeDocumentCorners.reduce((sum, p) => sum + p.y, 0) / 4;
      focusLockDocCenter = { x: avgX, y: avgY };
    } else {
      // Noch kein Dokument im Bild -> erst beim ersten Erkennen festlegen, um Fehlauslösung zu vermeiden
      focusLockDocCenter = null;
    }
  };

  const onUserTap = (e) => {
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.clientX !== undefined) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return;
    }

    const target = e.target;
    if (target && (target.closest("button") || target.closest("select") || target.closest(".scanned-pages-strip") || target.closest(".scanner-header") || target.closest("#filterMenu"))) {
      return;
    }

    handleTap(clientX, clientY);
  };

  // Sowohl PointerEvent als auch Touch-Fallback unterstützen
  if (window.PointerEvent) {
    videoWrapper.addEventListener("pointerdown", onUserTap);
  } else {
    videoWrapper.addEventListener("touchstart", onUserTap, { passive: true });
    videoWrapper.addEventListener("click", onUserTap);
  }

  // Bewegungssensor: Entsperrt Fokus bei spürbarer Bewegung oder Schwenk des Smartphones
  window.addEventListener("devicemotion", (e) => {
    if (!isFocusLocked || Date.now() - focusLockTimestamp < 2000) return;

    const acc = e.acceleration;
    if (acc && (Math.abs(acc.x) > 6.0 || Math.abs(acc.y) > 6.0 || Math.abs(acc.z) > 6.0)) {
      unlockFocus("Größere Gerätebewegung");
      return;
    }

    const rot = e.rotationRate;
    if (rot && (Math.abs(rot.alpha) > 120 || Math.abs(rot.beta) > 120 || Math.abs(rot.gamma) > 120)) {
      unlockFocus("Kameraschwenk");
    }
  });
}

// --- Taschenlampen Support ---
const torchBtn = document.getElementById("torchBtn");
let torchMode = "off"; // auto, off, on
let torchSupported = false;

async function updateTorchState() {
  if (!videoTrack) {
    return;
  }
  try {
    const capabilities = videoTrack.getCapabilities();
    if (capabilities.torch) {
      torchSupported = true;
      torchBtn.style.display = "flex";

      if (torchMode === "off") {
        await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
        torchBtn.innerHTML =
          '<span class="material-symbols-outlined">flashlight_off</span><small>Aus</small>';
        torchBtn.className = "modern-torch-btn torch-off";
      } else if (torchMode === "on") {
        await videoTrack.applyConstraints({ advanced: [{ torch: true }] });
        torchBtn.innerHTML =
          '<span class="material-symbols-outlined">flashlight_on</span><small>An</small>';
        torchBtn.className = "modern-torch-btn torch-on";
      } else if (torchMode === "auto") {
        await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
        torchBtn.innerHTML =
          '<span class="material-symbols-outlined">flashlight_on</span><small>Auto</small>';
        torchBtn.className = "modern-torch-btn torch-auto";
      }
    } else {
      torchBtn.style.display = "none";
    }
  } catch (e) {
    console.warn("Taschenlampe konnte nicht gesteuert werden:", e);
  }
}

if (torchBtn) {
  torchBtn.addEventListener("click", () => {
    if (!torchSupported) return;
    if (torchMode === "off") torchMode = "on";
    else if (torchMode === "on") torchMode = "auto";
    else torchMode = "off";
    updateTorchState();
  });
}

// --- Auto Capture Support ---
const autoCaptureBtn = document.getElementById("autoCaptureBtn");
const autoCountdown = document.getElementById("auto-countdown");
let autoCaptureEnabled = false;
let documentDetectionStart = 0;
let countdownInterval = null;
let autoCaptureTriggered = false;

// Button initial auf "Aus" setzen
if (autoCaptureBtn) {
  autoCaptureBtn.className = "scanner-control-btn auto-capture-toggle-btn";
  autoCaptureBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">document_scanner</span> <span>Auto: Aus</span>';

  autoCaptureBtn.addEventListener("click", () => {
    autoCaptureEnabled = !autoCaptureEnabled;
    if (autoCaptureEnabled) {
      autoCaptureBtn.className = "scanner-control-btn auto-capture-toggle-btn active";
      autoCaptureBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">document_scanner</span> <span>Auto: An</span>';
    } else {
      autoCaptureBtn.className = "scanner-control-btn auto-capture-toggle-btn";
      autoCaptureBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">document_scanner</span> <span>Auto: Aus</span>';
      cancelAutoCountdown();
    }
  });
}

function cancelAutoCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (autoCountdown) {
    autoCountdown.style.display = "none";
    autoCountdown.innerText = "2";
  }
  documentDetectionStart = 0;
  autoCaptureTriggered = false;
}

function startAutoCountdown() {
  if (countdownInterval || autoCaptureTriggered) return;
  autoCaptureTriggered = true;
  if (autoCountdown) {
    autoCountdown.style.display = "block";
    autoCountdown.innerText = "2";
  }
  let count = 2;

  countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      if (autoCountdown) autoCountdown.innerText = count.toString();
    } else {
      clearInterval(countdownInterval);
      countdownInterval = null;
      if (autoCountdown) autoCountdown.style.display = "none";

      if (smoothedCornersRaw && !captureBtn.disabled) {
        captureBtn.click();
      } else {
        cancelAutoCountdown();
      }
    }
  }, 1000);
}

// Kamera & Video Stream Management (Vorschau immer maximal 1080p oder weniger für flüssige 30-60 FPS)
let currentCameraResolution = "1080p";

async function startCamera(forceResolution = null) {
  if (sampleImage) sampleImage.style.display = "none";
  if (video) video.style.display = "block";
  activeSource = "camera";
  if (sourceSelect) sourceSelect.value = "camera";

  // Bestehende Video-Tracks vor dem Neuverbinden zwingend stoppen, um NotReadableError zu verhindern
  if (videoTrack) {
    try { videoTrack.stop(); } catch (_) { }
    videoTrack = null;
  }
  if (video && video.srcObject) {
    try {
      video.srcObject.getTracks().forEach((t) => t.stop());
    } catch (_) { }
    video.srcObject = null;
  }

  // Für die Live-Vorschau immer das native 4:3 Sensor-Format anfordern
  // Auf Smartphones im Hochformat (Portrait) hat das Bild mehr Höhe als Breite (3:4 Format, z.B. 1080x1440 oder 720x960)
  const isPortrait = window.innerHeight >= window.innerWidth;

  const candidateConstraints = [
    // 1. Primär: Echtes 4:3 Sensor-Format (im Hochformat 1080x1440, im Querformat 1440x1080)
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: isPortrait ? 1080 : 1440 },
        height: { ideal: isPortrait ? 1440 : 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    },
    // 2. 4:3 Sensor-Format Stufe 2 (im Hochformat 720x960, im Querformat 960x720)
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: isPortrait ? 720 : 960 },
        height: { ideal: isPortrait ? 960 : 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    },
    // 3. Fallback: 1080p Standard (im Hochformat 1080x1920, im Querformat 1920x1080)
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: isPortrait ? 1080 : 1920 },
        height: { ideal: isPortrait ? 1920 : 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    },
    // 4. Fallback: 720p Standard (im Hochformat 720x1280, im Querformat 1280x720)
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: isPortrait ? 720 : 1280 },
        height: { ideal: isPortrait ? 1280 : 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    },
    // 5. Beliebige Rückkamera
    {
      video: {
        facingMode: { ideal: "environment" },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    },
    // 6. Universeller Fallback
    {
      video: {
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];

  let stream = null;
  let lastErr = null;

  for (const constraints of candidateConstraints) {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) break;
      }
    } catch (e) {
      lastErr = e;
      console.warn("[Kamera] Constraint-Versuch fehlgeschlagen, probiere nächsten Fallback:", e);
      // Vor dem nächsten Versuch Tracks stoppen
      if (stream) {
        try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { }
        stream = null;
      }
    }
  }

  if (stream) {
    await setVideoStream(stream);
  } else {
    handleCameraFailure(lastErr);
  }
}

let currentBadgeWidth = 0;
let currentBadgeHeight = 0;
let currentBadgeFps = null;

function updateCameraResolutionBadge(width, height, fps = null) {
  const badge = document.getElementById("cameraResIndicator");
  const textEl = document.getElementById("cameraResText");
  const dividerEl = document.getElementById("cameraFpsDivider");
  const fpsEl = document.getElementById("cameraFpsText");
  if (!badge || !textEl) return;

  if (width && height) {
    currentBadgeWidth = width;
    currentBadgeHeight = height;
  }
  if (fps !== null) {
    currentBadgeFps = Math.round(fps);
  }

  if (!currentBadgeWidth || !currentBadgeHeight) {
    badge.style.display = "none";
    return;
  }

  badge.style.display = "inline-flex";
  const maxDim = Math.max(currentBadgeWidth, currentBadgeHeight);
  const minDim = Math.min(currentBadgeWidth, currentBadgeHeight);

  // Bestimme Format & Seitenverhältnis
  const aspect = maxDim / (minDim || 1);
  let ratioStr = "";
  if (Math.abs(aspect - 4 / 3) < 0.12) {
    ratioStr = "4:3";
  } else if (Math.abs(aspect - 16 / 9) < 0.12) {
    ratioStr = "16:9";
  } else if (Math.abs(aspect - 1.0) < 0.12) {
    ratioStr = "1:1";
  }

  let label = `${minDim}p`;
  if (maxDim >= 3000) {
    label = "4K";
  } else if (minDim >= 1000 || maxDim >= 1400) {
    label = "1080p";
  } else if (minDim >= 700 || maxDim >= 900) {
    label = "720p";
  }

  textEl.textContent = ratioStr ? `${label} (${ratioStr})` : label;

  if (fpsEl && dividerEl) {
    if (currentBadgeFps !== null && currentBadgeFps > 0) {
      fpsEl.textContent = `${currentBadgeFps} FPS`;
      fpsEl.style.display = "inline";
      dividerEl.style.display = "inline";
    } else {
      fpsEl.style.display = "none";
      dividerEl.style.display = "none";
    }
  }

  const fpsStr = currentBadgeFps ? ` @ ${currentBadgeFps} FPS` : "";
  badge.title = `Kamera: ${currentBadgeWidth} × ${currentBadgeHeight} px (${label} ${ratioStr})${fpsStr}`;
}

async function setVideoStream(stream) {
  video.srcObject = stream;
  videoTrack = stream.getVideoTracks()[0];
  try {
    await video.play();
  } catch (_) { }

  // Hardware-Vorschau auf max. 30 FPS begrenzen, ohne das Seitenverhältnis zu beschneiden
  if (videoTrack && videoTrack.applyConstraints) {
    try {
      await videoTrack.applyConstraints({ frameRate: { ideal: 30, max: 30 } });
    } catch (_) { }
  }

  updateTorchState();
  await initAutofocus();

  const currentW = video.videoWidth || ((videoTrack && videoTrack.getSettings) ? videoTrack.getSettings().width : 0);
  const currentH = video.videoHeight || ((videoTrack && videoTrack.getSettings) ? videoTrack.getSettings().height : 0);
  if (currentW > 0 && currentH > 0) {
    updateCameraResolutionBadge(currentW, currentH);
  }

  if (!streaming && video.videoWidth > 0 && activeSource === "camera") {
    updateOverlayGeometry();
    streaming = true;
    captureBtn.disabled = false;
    setTimeout(processVideo, 60);
  }

  // Überwache kontinuierlich die reale FPS-Rate der Hardware und zeige sie oben an
  monitorCameraFpsAndAdapt();
}

function pauseCameraAndInference() {
  streaming = false;
  isProcessingFrame = false;
  cancelAutoCountdown();
  unlockFocus("Kamera pausiert");

  if (fpsMonitorInterval) {
    clearInterval(fpsMonitorInterval);
    fpsMonitorInterval = null;
  }

  // Video-Tracks stoppen & Kamera-Hardware freigeben (spart Akku & schützt vor Hitzeentwicklung)
  if (videoTrack) {
    try { videoTrack.stop(); } catch (_) { }
    videoTrack = null;
  }
  if (video && video.srcObject) {
    try {
      video.srcObject.getTracks().forEach((t) => t.stop());
    } catch (_) { }
    video.srcObject = null;
  }
  cameraStarted = false;
  console.log("[Scanner] Kamera & ONNX-Inferenz im Review-Modus erfolgreich pausiert.");
}

async function resumeCameraAndInference() {
  if (streaming && cameraStarted) return;
  console.log("[Scanner] Re-aktiviere Kamera & ONNX-Inferenz...");
  if (activeSource === "camera") {
    cameraStarted = true;
    await startCamera();
  } else {
    streaming = true;
    setTimeout(processVideo, 50);
  }
}

function handleCameraFailure(fallbackErr) {
  console.warn("Kamera konnte nicht gestartet werden:", fallbackErr);

  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const originUrl = window.location.origin;
    alert(
      "⚠️ Kamerazugriff blockiert (Kein HTTPS):\n\n" +
      "Mobile Browser (Chrome & Safari) sperren den Kamerazugriff im Netzwerk über unverschlüsseltes HTTP.\n\n" +
      "Schnelle Lösung für Android (Chrome):\n" +
      "1. Öffne auf dem Smartphone: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n" +
      "2. Trage ein: " + originUrl + "\n" +
      "3. Auf 'Enabled' stellen und Chrome neu starten.\n\n" +
      "Schnelle Lösung für iPhone / Universal:\n" +
      "Starte am PC im Terminal: npx localtunnel --port 3000 und öffne die https-Adresse."
    );
    return;
  }

  alert("Kein Zugriff auf die Kamera möglich. Bitte erlaube den Kamerazugriff im Browser oder prüfe, ob die Kamera durch eine andere Anwendung belegt ist.");
}

let fpsMonitorInterval = null;
let isFpsMonitoringActive = false;
let measuredCameraFps = null;
let lastPresentedFrames = 0;
let lastPresentedTime = 0;

function getEffectiveCameraFps() {
  if (measuredCameraFps && measuredCameraFps > 0) {
    return measuredCameraFps;
  }
  const settings = (videoTrack && videoTrack.getSettings) ? videoTrack.getSettings() : {};
  if (settings.frameRate && settings.frameRate > 0) {
    return Math.round(settings.frameRate);
  }
  return 30;
}

function startHardwareFpsTracker() {
  if (isFpsMonitoringActive) return;
  isFpsMonitoringActive = true;
  lastPresentedFrames = 0;
  lastPresentedTime = 0;

  const onVideoFrame = (now, metadata) => {
    if (!isFpsMonitoringActive || !videoTrack || videoTrack.readyState !== "live") {
      isFpsMonitoringActive = false;
      return;
    }

    if (metadata && typeof metadata.presentedFrames === "number") {
      if (lastPresentedFrames > 0 && lastPresentedTime > 0) {
        const timeDiff = (now - lastPresentedTime) / 1000;
        if (timeDiff >= 0.75) {
          const framesDiff = metadata.presentedFrames - lastPresentedFrames;
          if (framesDiff >= 0 && timeDiff > 0) {
            const rawFps = framesDiff / timeDiff;
            measuredCameraFps = Math.min(Math.round(rawFps), 120);
          }
          lastPresentedFrames = metadata.presentedFrames;
          lastPresentedTime = now;
        }
      } else {
        lastPresentedFrames = metadata.presentedFrames;
        lastPresentedTime = now;
      }
    }

    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(onVideoFrame);
    }
  };

  if ("requestVideoFrameCallback" in video) {
    video.requestVideoFrameCallback(onVideoFrame);
  }
}

function monitorCameraFpsAndAdapt() {
  if (fpsMonitorInterval) {
    clearInterval(fpsMonitorInterval);
    fpsMonitorInterval = null;
  }
  if (!videoTrack) return;

  startHardwareFpsTracker();

  let consecutiveLowFpsSeconds = 0;
  let elapsedIntervals = 0;

  fpsMonitorInterval = setInterval(async () => {
    if (!videoTrack || videoTrack.readyState !== "live" || activeSource !== "camera") {
      clearInterval(fpsMonitorInterval);
      fpsMonitorInterval = null;
      isFpsMonitoringActive = false;
      return;
    }

    elapsedIntervals++;
    const actualWidth = video.videoWidth || ((videoTrack.getSettings && videoTrack.getSettings().width) || 0);
    const actualHeight = video.videoHeight || ((videoTrack.getSettings && videoTrack.getSettings().height) || 0);
    const effectiveFps = getEffectiveCameraFps();

    if (actualWidth > 0 && actualHeight > 0) {
      updateCameraResolutionBadge(actualWidth, actualHeight, effectiveFps);
    }

    // Sicherstellen, dass die Live-Vorschau immer maximal 1080p/1440p (oder weniger) nutzt
    if (Math.max(actualWidth, actualHeight) > 1920) {
      console.warn(`[Kamera] Vorschau-Auflösung (${actualWidth}x${actualHeight}px) übersteigt 1080p. Drossle auf 1080p...`);
      await switchTo1080p();
    }
  }, 1000);
}

async function switchTo1080p() {
  currentCameraResolution = "1080p";
  if (!videoTrack) return;

  const isPortrait = window.innerHeight >= window.innerWidth;

  try {
    // Versuch 1: In-Place Constraints (unterbrechungsfrei) im nativen Sensorformat
    await videoTrack.applyConstraints({
      width: { ideal: isPortrait ? 1080 : 1440 },
      height: { ideal: isPortrait ? 1440 : 1080 },
      frameRate: { ideal: 30, max: 30 },
    });
    updateOverlayGeometry();
    const w = video.videoWidth || (videoTrack.getSettings && videoTrack.getSettings().width) || (isPortrait ? 1080 : 1440);
    const h = video.videoHeight || (videoTrack.getSettings && videoTrack.getSettings().height) || (isPortrait ? 1440 : 1080);
    updateCameraResolutionBadge(w, h);
    console.log("[Kamera] Erfolgreich auf Sensor-Auflösung umgeschaltet (applyConstraints).");
  } catch (e) {
    console.warn("[Kamera] In-Place Wechsel auf 1080p nicht möglich, starte Stream neu:", e);
    if (videoTrack) {
      try { videoTrack.stop(); } catch (_) { }
      videoTrack = null;
    }
    await startCamera("1080p");
  }
}

// Test-Bild Loader für Entwicklungs- & Testpipeline
function loadSampleImage(filename) {
  if (videoTrack) {
    try {
      videoTrack.stop();
      videoTrack = null;
    } catch (e) { }
  }
  if (video) video.style.display = "none";
  if (sampleImage) {
    sampleImage.style.display = "block";
    sampleImage.src = "/samples-scanner/" + filename;
    sampleImage.onload = () => {
      console.log(`Test-Bild '${filename}' geladen (${sampleImage.naturalWidth}x${sampleImage.naturalHeight})`);
      updateCameraResolutionBadge(sampleImage.naturalWidth, sampleImage.naturalHeight);
      updateOverlayGeometry();
      streaming = true;
      captureBtn.disabled = false;
      smoothedCornersRaw = null;
      framesWithoutDetection = 0;

      requestAnimationFrame(processVideo);
    };
  }
}

if (sourceSelect) {
  sourceSelect.addEventListener("change", (e) => {
    activeSource = e.target.value;
    smoothedCornersRaw = null;
    currentRelativeDocumentCorners = null;
    ctxOverlay.clearRect(0, 0, overlay.width, overlay.height);

    if (activeSource === "camera") {
      startCamera();
    } else {
      loadSampleImage(activeSource);
    }
  });
}

function onSystemReady() {
  if (!cameraStarted && (onnxReady || onnxLoadFailed)) {
    cameraStarted = true;
    loadingText.style.display = "none";
    videoWrapper.style.display = "flex";
    captureBtn.style.display = "block";
    captureBtn.disabled = false;

    if (activeSource === "camera") {
      startCamera();
    } else {
      loadSampleImage(activeSource);
    }
  }
}

video.addEventListener("canplay", function () {
  if (video.videoWidth > 0 && video.videoHeight > 0 && activeSource === "camera") {
    updateCameraResolutionBadge(video.videoWidth, video.videoHeight);
    updateOverlayGeometry();
  }

  if (!streaming && video.videoWidth > 0 && activeSource === "camera") {
    updateOverlayGeometry();
    streaming = true;
    captureBtn.disabled = false;
    requestAnimationFrame(processVideo);
  }
});

// Fenstergrößen- und Orientierungs-Änderungen überwachen
window.addEventListener("resize", () => {
  if (streaming && (video || sampleImage)) {
    updateOverlayGeometry();
  }
});
window.addEventListener("orientationchange", () => {
  setTimeout(async () => {
    if (streaming && activeSource === "camera") {
      await startCamera();
    } else {
      updateOverlayGeometry();
    }
  }, 200);
});

let isProcessingFrame = false;

async function processVideo() {
  if (!streaming) return;

  if (isProcessingFrame) {
    setTimeout(processVideo, 30);
    return;
  }

  isProcessingFrame = true;

  try {
    const currentSource = activeSource === "camera" ? video : sampleImage;
    if (!currentSource || (activeSource === "camera" && (!video.videoWidth || video.readyState < 2))) {
      isProcessingFrame = false;
      setTimeout(processVideo, 50);
      return;
    }

    updateOverlayGeometry();

    const srcW = activeSource === "camera" ? video.videoWidth : (sampleImage.naturalWidth || 800);
    const srcH = activeSource === "camera" ? video.videoHeight : (sampleImage.naturalHeight || 600);

    let detectedCorners = null;
    if (onnxReady) {
      // Immer den gesamten Sensor / unbeschnittenen Frame für die Verarbeitung nutzen!
      detectedCorners = await detectCornersOnnx(currentSource, 0, 0, srcW, srcH);
    }

    // --- ADAPTIVES SMOOTHING / ANTI-FLICKERING LOGIK ---
    if (detectedCorners && detectedCorners.length === 4) {
      framesWithoutDetection = 0;
      const sortedNewCorners = sortAndOrderCorners(detectedCorners);

      if (!smoothedCornersRaw) {
        smoothedCornersRaw = sortedNewCorners.map((p) => ({ x: p.x, y: p.y }));
      } else {
        smoothedCornersRaw = applyAdaptiveSmoothing(
          smoothedCornersRaw,
          sortedNewCorners,
          SMOOTHING_INERTIA
        );
      }

      // Auto-Capture Logik
      if (autoCaptureEnabled && !captureBtn.disabled) {
        if (documentDetectionStart === 0) {
          documentDetectionStart = Date.now();
        } else if (Date.now() - documentDetectionStart >= 1000 && !autoCaptureTriggered) {
          startAutoCountdown();
        }
      } else {
        documentDetectionStart = 0;
        if (countdownInterval && !autoCaptureTriggered) cancelAutoCountdown();
      }
    } else {
      steadyDocFrames = 0;
      lastDocCenterBeforeLock = null;
      framesWithoutDetection++;

      if (autoCaptureTriggered && framesWithoutDetection > 7) {
        cancelAutoCountdown();
      }

      if (framesWithoutDetection > MAX_FRAMES_LOSE_TRACK) {
        smoothedCornersRaw = null;
        cancelAutoCountdown();

        // Wenn das Dokument komplett verschwunden ist, Fokus wieder auf kontinuierlich freigeben.
        // WICHTIG: Nur wenn Fokus automatisch eingerastet war (!isTapLocked).
        // Wenn der Nutzer manuell getippt hat, bleibt der Fokus gehalten!
        if (isFocusLocked && !isTapLocked && Date.now() - focusLockTimestamp > 1200) {
          unlockFocus("Motiv entfernt");
        }
      }
    }

    // Zeichenfläche leeren
    ctxOverlay.clearRect(0, 0, overlay.width, overlay.height);

    // Zeichne das geglättete Polygon
    if (smoothedCornersRaw) {
      currentRelativeDocumentCorners = [];
      ctxOverlay.beginPath();
      for (let i = 0; i < 4; i++) {
        let relativeX = smoothedCornersRaw[i].x;
        let relativeY = smoothedCornersRaw[i].y;
        currentRelativeDocumentCorners.push({ x: relativeX, y: relativeY });

        let x = relativeX * overlay.width;
        let y = relativeY * overlay.height;

        if (i === 0) {
          ctxOverlay.moveTo(x, y);
        } else {
          ctxOverlay.lineTo(x, y);
        }
      }
      ctxOverlay.closePath();
      ctxOverlay.lineWidth = 4;
      ctxOverlay.strokeStyle = "rgba(40, 167, 69, 0.9)";
      ctxOverlay.fillStyle = "rgba(40, 167, 69, 0.2)";
      ctxOverlay.fill();
      ctxOverlay.stroke();

      const curCenterX = currentRelativeDocumentCorners.reduce((sum, p) => sum + p.x, 0) / 4;
      const curCenterY = currentRelativeDocumentCorners.reduce((sum, p) => sum + p.y, 0) / 4;

      // Fall 1: Noch nicht gelockt -> Sobald Beleg ruhig gehalten wird, Fokus einmalig fixieren
      if (!isFocusLocked && activeSource === "camera") {
        if (lastDocCenterBeforeLock) {
          const drift = Math.hypot(curCenterX - lastDocCenterBeforeLock.x, curCenterY - lastDocCenterBeforeLock.y);
          if (drift < 0.035) {
            steadyDocFrames++;
            if (steadyDocFrames >= 10) { // ca. 350-400ms ruhig gehalten
              lockSteadyFocus(curCenterX, curCenterY);
            }
          } else {
            steadyDocFrames = 0;
          }
        }
        lastDocCenterBeforeLock = { x: curCenterX, y: curCenterY };
      }

      // Fall 2: Fokus ist gelockt (steady oder per Tippen) -> Prüfe auf größere Bewegung / Motivwechsel
      if (isFocusLocked && Date.now() - focusLockTimestamp > 1500) {
        if (focusLockDocCenter) {
          const shiftDist = Math.hypot(curCenterX - focusLockDocCenter.x, curCenterY - focusLockDocCenter.y);
          if (shiftDist > 0.35) { // mehr als 35% Bildschirmsprung = eindeutig neues Motiv
            unlockFocus("Größere Bildverschiebung / Neues Motiv");
          }
        } else {
          focusLockDocCenter = { x: curCenterX, y: curCenterY };
        }
      }
    } else {
      currentRelativeDocumentCorners = null;
    }
  } catch (err) {
    console.error("Frame-Verarbeitung Fehler:", err);
  } finally {
    isProcessingFrame = false;
  }

  // Nächster Frame: Nur setTimeout, kein requestAnimationFrame.
  // rAF würde [Violation] 'requestAnimationFrame handler took Nms' auslösen,
  // da ONNX-Inferenz mehrere 100ms braucht und den Paint-Thread blockiert.
  setTimeout(processVideo, 35);
}

// --- Hochpräziser 2-Stufen ONNX Re-Scan auf dem hochauflösenden Rohfoto ---
async function performDetailedPostScan(canvasHighRes, initialRelativeCorners) {
  if (!canvasHighRes || canvasHighRes.width <= 0 || canvasHighRes.height <= 0) {
    return initialRelativeCorners;
  }

  if (!onnxReady) {
    return initialRelativeCorners;
  }

  try {
    console.log("[Scanner] Führe detaillierten 2-Stufen ONNX Re-Scan auf Rohfoto durch...");
    const W = canvasHighRes.width;
    const H = canvasHighRes.height;

    // Stufe 1: Globale Erkennung auf dem hochauflösenden Vollbild
    let stage1Corners = await detectCornersOnnx(canvasHighRes, 0, 0, W, H);
    if (!stage1Corners && initialRelativeCorners && initialRelativeCorners.length === 4) {
      stage1Corners = initialRelativeCorners;
    }

    if (!stage1Corners || stage1Corners.length !== 4) {
      return initialRelativeCorners;
    }

    // Stufe 2: Zoom-ROI Erkennung (Hierarchischer Re-Scan)
    // Wir fokussieren das 256x256 KI-Netzwerk direkt auf den Belegbereich mit 15% Puffer.
    // Dadurch verdreifacht sich die Auflösung der Kanten/Ecken im Neuronalen Netz!
    const xs = stage1Corners.map((c) => c.x * W);
    const ys = stage1Corners.map((c) => c.y * H);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const padX = (maxX - minX) * 0.15;
    const padY = (maxY - minY) * 0.15;

    const roiX = Math.max(0, Math.floor(minX - padX));
    const roiY = Math.max(0, Math.floor(minY - padY));
    const roiW = Math.min(W - roiX, Math.ceil(maxX - minX + 2 * padX));
    const roiH = Math.min(H - roiY, Math.ceil(maxY - minY + 2 * padY));

    if (roiW > 100 && roiH > 100) {
      const stage2Corners = await detectCornersOnnx(canvasHighRes, roiX, roiY, roiW, roiH);
      if (stage2Corners && stage2Corners.length === 4 && isPlausibleDocumentShape(stage2Corners)) {
        // Rechne die feinen ROI-Ecken zurück in relative Koordinaten des Gesamtbildes
        const detailedCorners = stage2Corners.map((c) => ({
          x: (roiX + c.x * roiW) / W,
          y: (roiY + c.y * roiH) / H,
        }));
        const sortedDetailed = sortAndOrderCorners(detailedCorners);
        if (isPlausibleDocumentShape(sortedDetailed)) {
          console.log("[Scanner] Detaillierter 2-Stufen ONNX Re-Scan erfolgreich: Kanten millimetergenau optimiert ✓");
          return sortedDetailed;
        }
      }
    }

    return stage1Corners;
  } catch (err) {
    console.warn("[Scanner] Detaillierter Re-Scan Fehler, verwende Initial-Ecken:", err);
    return initialRelativeCorners;
  }
}

captureBtn.addEventListener("click", async () => {
  if (!streaming) return;

  const algSelect = document.getElementById("algorithmSelect");
  if (algSelect) algSelect.value = "auto";
  const prevAlgSelect = document.getElementById("previewAlgorithmSelect");
  if (prevAlgSelect) prevAlgSelect.value = "auto";

  cancelAutoCountdown();

  let frozenCorners = currentRelativeDocumentCorners
    ? JSON.parse(JSON.stringify(currentRelativeDocumentCorners))
    : null;
  captureBtn.disabled = true;

  let originalWidth = activeSource === "camera" ? (video ? video.videoWidth : 1920) : (sampleImage.naturalWidth || 1920);
  let originalHeight = activeSource === "camera" ? (video ? video.videoHeight : 1080) : (sampleImage.naturalHeight || 1080);
  let photoWasUsed = false;
  let highResBitmap = null;

  if (activeSource === "camera") {
    if (window.ImageCapture && videoTrack) {
      let flashWasTriggered = false;
      try {
        const imageCapture = new ImageCapture(videoTrack);
        const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
        const advancedConstraints = [];

        if (torchSupported && torchMode === "auto") {
          advancedConstraints.push({ torch: true });
          flashWasTriggered = true;
        }

        if (advancedConstraints.length > 0) {
          await videoTrack.applyConstraints({ advanced: advancedConstraints });
          if (flashWasTriggered) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        // Prio 1: Echte Aufnahme über den Still-Photo Sensorpfad (takePhoto)
        // Volle Sensorauflösung unter Beibehaltung des nativen Sensor-Seitenverhältnisses (z. B. 4:3)
        let stillImageBitmap = null;
        if (typeof imageCapture.takePhoto === "function") {
          try {
            let photoOptions = {};
            if (typeof imageCapture.getPhotoCapabilities === "function") {
              const photoCaps = await imageCapture.getPhotoCapabilities();
              if (photoCaps.imageWidth && photoCaps.imageWidth.max && photoCaps.imageHeight && photoCaps.imageHeight.max) {
                const maxW = photoCaps.imageWidth.max;
                const maxH = photoCaps.imageHeight.max;
                // Nativ-Seitenverhältnis des Sensors beibehalten (kein erzwungenes 16:9)
                if (maxW > 4096) {
                  const ratio = maxH / maxW;
                  photoOptions.imageWidth = 4096;
                  photoOptions.imageHeight = Math.round(4096 * ratio);
                } else {
                  photoOptions.imageWidth = maxW;
                  photoOptions.imageHeight = maxH;
                }
              }
            }
            console.log("[Scanner] Erfasse hochauflösendes Sensor-Foto via ImageCapture.takePhoto()...", photoOptions);
            const photoBlob = await imageCapture.takePhoto(photoOptions);
            if (photoBlob) {
              stillImageBitmap = await createImageBitmap(photoBlob);
              console.log(`[Scanner] Foto in voller Sensorauflösung erfasst: ${stillImageBitmap.width} × ${stillImageBitmap.height} px ✓`);
            }
          } catch (takePhotoErr) {
            console.warn("[Scanner] takePhoto fehlgeschlagen, falle zurück auf Stream-Frame:", takePhotoErr);
          }
        }

        // Prio 2: Fallback auf aktuellen Stream-Frame (grabFrame)
        if (!stillImageBitmap) {
          stillImageBitmap = await imageCapture.grabFrame();
        }

        highResBitmap = stillImageBitmap;
        originalWidth = stillImageBitmap.width;
        originalHeight = stillImageBitmap.height;
        photoWasUsed = true;
      } catch (e) {
        console.warn("Fotofunktion nicht per API abrufbar, falle zurück auf Video Capture", e);
      } finally {
        if (videoTrack && flashWasTriggered) {
          try {
            await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
          } catch (restoreErr) { }
        }
      }
    }
  } else {
    originalWidth = sampleImage.naturalWidth;
    originalHeight = sampleImage.naturalHeight;
    photoWasUsed = true;
  }

  const canvasHighRes = document.createElement("canvas");
  canvasHighRes.width = originalWidth;
  canvasHighRes.height = originalHeight;
  const ctxHighRes = canvasHighRes.getContext("2d");

  if (photoWasUsed) {
    if (activeSource === "camera") {
      ctxHighRes.drawImage(highResBitmap, 0, 0);
    } else {
      ctxHighRes.drawImage(sampleImage, 0, 0);
    }

    if (frozenCorners && streaming) {
      const vidW = activeSource === "camera" ? video.videoWidth : sampleImage.naturalWidth;
      const vidH = activeSource === "camera" ? video.videoHeight : sampleImage.naturalHeight;

      if (vidW > 0 && vidH > 0) {
        const previewAspect = vidW / vidH;
        const photoAspect = originalWidth / originalHeight;

        // Wenn Foto und Video-Vorschau das gleiche Seitenverhältnis haben, mappen die Ecken 1:1.
        // Bei abweichendem Seitenverhältnis (z. B. Video-Vorschau zentriert aus 4:3 Sensor):
        if (Math.abs(previewAspect - photoAspect) > 0.02) {
          if (previewAspect > photoAspect) {
            // Preview ist breiter als Sensor-Foto -> Preview war vertikal zentriert gecroppt
            const visiblePhotoH = originalWidth / previewAspect;
            const offsetY = (originalHeight - visiblePhotoH) / 2;
            frozenCorners = frozenCorners.map((fc) => ({
              x: fc.x,
              y: (offsetY + fc.y * visiblePhotoH) / originalHeight,
            }));
          } else {
            // Preview ist schmaler als Sensor-Foto -> Preview war horizontal zentriert gecroppt
            const visiblePhotoW = originalHeight * previewAspect;
            const offsetX = (originalWidth - visiblePhotoW) / 2;
            frozenCorners = frozenCorners.map((fc) => ({
              x: (offsetX + fc.x * visiblePhotoW) / originalWidth,
              y: fc.y,
            }));
          }
        }
      }
    }
  } else {
    // Reiner Video-Fallback: Vollständiges Kamerabild ohne Beschneidung durch Bildschirm-Format erfassen
    canvasHighRes.width = originalWidth;
    canvasHighRes.height = originalHeight;
    ctxHighRes.drawImage(video, 0, 0, originalWidth, originalHeight);
  }

  // Pausiere Kamera und Live-ONNX-Inferenz sofort nach dem Foto-Schnappschuss
  pauseCameraAndInference();

  let hasRealCorners = !!frozenCorners;

  // Detaillierter Re-Scan auf dem hochauflösenden Rohfoto (immer ausführen für perfekten Sitz!)
  try {
    const refinedCorners = await performDetailedPostScan(canvasHighRes, frozenCorners);
    if (refinedCorners && refinedCorners.length === 4) {
      frozenCorners = refinedCorners;
      hasRealCorners = true;
    }
  } catch (e) {
    console.error("Post-Scan fehlgeschlagen:", e);
  }

  // Wenn am Ende immer noch keine gültigen Ecken vorliegen
  if (!frozenCorners) {
    hasRealCorners = false;
    frozenCorners = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
  }

  // Zeige Editier-Ansicht ("Manual Review")
  showManualReview(canvasHighRes, frozenCorners, hasRealCorners);
});

let scanPagesArray = []; // Speichert die Blobs, wenn "Nächste Seite scannen" gedrückt wurde
let reviewState = {
  highResCanvas: null,
  cropX: 0,
  cropY: 0,
  cropW: 0,
  cropH: 0,
  corners: [], // Kanten bezogen auf das ReviewCanvas
  activeCorner: -1,
};

const reviewCanvas = document.getElementById("reviewCanvas");
const reviewOverlay = document.getElementById("reviewOverlay");
const previewLoadingText = document.getElementById("previewLoadingText");
const algorithmSelect = document.getElementById("algorithmSelect");
const previewAlgorithmSelect = document.getElementById("previewAlgorithmSelect");
const manualReviewSection = document.getElementById("manual-review-section");

function syncFilterPresetButtons(alg) {
  const currentAlg = alg || algorithmSelect?.value || "auto";
  const presetMatchMap = {
    color: ["photo", "original"],
    color_enhanced: ["color_doc"],
    white_paper: ["doc", "clean"],
    auto: ["doc", "clean"],
    bw_adaptive: ["bw"],
    grayscale: ["bw"],
  };
  const activeTypes = presetMatchMap[currentAlg] || [];
  document.querySelectorAll(".filter-preset-btn").forEach((btn) => {
    const fType = btn.getAttribute("data-filter");
    btn.classList.toggle("active", activeTypes.includes(fType));
  });
}

function updatePreviewFilter() {
  const filter = algorithmSelect?.value || "auto";
  const rCv = reviewCanvas;
  if (!rCv || !reviewState.highResCanvas) return;

  // Zuerst immer das originale (ungefilterte), um 20% erweiterte Bild zurückholen
  rCv.width = reviewState.cropW;
  rCv.height = reviewState.cropH;
  rCv
    .getContext("2d")
    .drawImage(
      reviewState.highResCanvas,
      reviewState.cropX,
      reviewState.cropY,
      reviewState.cropW,
      reviewState.cropH,
      0,
      0,
      reviewState.cropW,
      reviewState.cropH
    );

  rCv.style.filter = "none"; // CSS-Reset

  // Original überspringt alles und behält einfach das ungefilterte High-Res Segment
  if (filter === "color") {
    if (previewLoadingText) previewLoadingText.style.display = "none";
    syncFilterPresetButtons("color");
    fitReviewCanvas();
    drawReviewOverlay();
    return;
  }

  // Optisches Feedback, dass es lädt
  if (previewLoadingText) previewLoadingText.style.display = "block";

  // Neues echtes OpenCV-Preview generieren
  rCv.toBlob(
    async (blob) => {
      let formData = new FormData();
      formData.append("image", blob, "preview.jpg");
      formData.append("algorithm", filter);

      // Reiche die ausgewählten 4 Eckpunkte mit an das Backend für korrekte Auto-Berechnung
      let coordsArr = [];
      if (reviewState.corners.length === 4) {
        reviewState.corners.forEach((c) => coordsArr.push(c.x, c.y));
        formData.append("coords", coordsArr.join(","));
      } else {
        formData.append("coords", "skip");
      }

      try {
        const response = await fetch("/api/preview", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) throw new Error("Preview Fetch fail");

        const detectedAlgorithm = response.headers.get("X-Detected-Algorithm");
        if (detectedAlgorithm) {
          if (previewAlgorithmSelect && previewAlgorithmSelect.querySelector(`option[value="${detectedAlgorithm}"]`)) {
            previewAlgorithmSelect.value = detectedAlgorithm;
          }
          if (filter === "auto" && algorithmSelect) {
            algorithmSelect.value = detectedAlgorithm;
          }
          // Vorschlag der Automatik in den Filter-Buttons hervorheben
          syncFilterPresetButtons(detectedAlgorithm);
        }

        const imgBlob = await response.blob();
        const url = URL.createObjectURL(imgBlob);

        const img = new Image();
        img.onload = () => {
          rCv.getContext("2d").drawImage(img, 0, 0, reviewState.cropW, reviewState.cropH);
          if (previewLoadingText) previewLoadingText.style.display = "none";
          URL.revokeObjectURL(url);
          fitReviewCanvas();
          drawReviewOverlay();
        };
        img.src = url;
      } catch (err) {
        console.error("Preview Fehler: ", err);
        if (previewLoadingText) previewLoadingText.style.display = "none";
      }
    },
    "image/jpeg",
    0.85
  );
}

function showManualReview(highResCanvas, relativeCorners, hasRealCorners = true) {
  // Pausiere Kameraanzeige, Hardware-Tracks und Live-ONNX-Inferenz
  pauseCameraAndInference();
  videoWrapper.style.display = "none";
  captureBtn.style.display = "none";
  captureBtn.disabled = true;
  const filterMenu = document.getElementById("filterMenu");
  if (filterMenu) filterMenu.style.display = "none";
  if (manualReviewSection) manualReviewSection.style.display = "flex";
  updateConfirmBtnText();

  reviewState.highResCanvas = highResCanvas;

  // Finde die absoluten Grenzen (Min/Max X und Y) der markierten Ecken im Originalbild, um den Rand zu berechnen
  let xs = relativeCorners.map((c) => c.x * highResCanvas.width);
  let ys = relativeCorners.map((c) => c.y * highResCanvas.height);
  let minX = Math.min(...xs),
    maxX = Math.max(...xs);
  let minY = Math.min(...ys),
    maxY = Math.max(...ys);

  // Füge 20% Puffer um den erkannten Rahmen hinzu, damit der User noch genügend Rand um den Ausschnitt sieht
  let padX = (maxX - minX) * 0.20;
  let padY = (maxY - minY) * 0.20;

  const left = Math.max(0, Math.floor(minX - padX));
  const top = Math.max(0, Math.floor(minY - padY));
  const right = Math.min(highResCanvas.width, Math.ceil(maxX + padX));
  const bottom = Math.min(highResCanvas.height, Math.ceil(maxY + padY));

  reviewState.cropX = left;
  reviewState.cropY = top;
  reviewState.cropW = Math.max(50, right - left);
  reviewState.cropH = Math.max(50, bottom - top);

  // Lade diesen Puffer-Zuschnitt in den ReviewCanvas
  if (reviewCanvas) {
    reviewCanvas.width = reviewState.cropW;
    reviewCanvas.height = reviewState.cropH;
    reviewCanvas
      .getContext("2d")
      .drawImage(
        highResCanvas,
        reviewState.cropX,
        reviewState.cropY,
        reviewState.cropW,
        reviewState.cropH,
        0,
        0,
        reviewState.cropW,
        reviewState.cropH
      );
  }

  // Passe Overlay (Zeichenfläche) exakt auf das Canvas an
  if (reviewOverlay) {
    reviewOverlay.width = reviewState.cropW;
    reviewOverlay.height = reviewState.cropH;
  }

  // Rechne die 4 Originalecken in das lokale (abgeschnittene) Review-Bild um
  const orderedRelativeCorners = sortAndOrderCorners(relativeCorners);
  reviewState.corners = orderedRelativeCorners.map((c) => ({
    x: Math.round(c.x * highResCanvas.width - reviewState.cropX),
    y: Math.round(c.y * highResCanvas.height - reviewState.cropY),
  }));

  // Initialisiere Filter auf Auto und synchronisiere Buttons
  if (algorithmSelect) algorithmSelect.value = "auto";
  syncFilterPresetButtons("auto");

  fitReviewCanvas();
  requestAnimationFrame(() => {
    fitReviewCanvas();
    drawReviewOverlay();
  });
  setTimeout(() => { fitReviewCanvas(); drawReviewOverlay(); }, 80);
  setTimeout(() => { fitReviewCanvas(); drawReviewOverlay(); }, 200);

  // Vermeide den Preview-Lader, falls ohnehin keine klaren Kanten erkannt wurden
  if (hasRealCorners) {
    updatePreviewFilter();
  } else if (previewLoadingText) {
    previewLoadingText.style.display = "none";
  }

  drawReviewOverlay();
}

const reviewCanvasWrapper = document.querySelector(".review-canvas-wrapper");

function fitReviewCanvas() {
  if (!manualReviewSection || manualReviewSection.style.display === "none") return;
  const wrapper = reviewCanvasWrapper || document.querySelector(".review-canvas-wrapper");
  const rCv = reviewCanvas;
  const oCv = reviewOverlay;
  if (!wrapper || !rCv || !oCv || !reviewState.cropW || !reviewState.cropH) return;

  const availW = Math.max(50, wrapper.clientWidth - 16);
  const availH = Math.max(50, wrapper.clientHeight - 16);
  if (availW <= 0 || availH <= 0) return;

  const aspect = reviewState.cropW / reviewState.cropH;
  let targetW, targetH;

  if (availW / availH > aspect) {
    targetH = availH;
    targetW = targetH * aspect;
  } else {
    targetW = availW;
    targetH = targetW / aspect;
  }

  targetW = Math.floor(Math.min(targetW, availW));
  targetH = Math.floor(Math.min(targetH, availH));

  rCv.style.width = targetW + "px";
  rCv.style.height = targetH + "px";
  oCv.style.width = targetW + "px";
  oCv.style.height = targetH + "px";
}

window.addEventListener("resize", fitReviewCanvas);
window.addEventListener("orientationchange", () => setTimeout(fitReviewCanvas, 100));
window.addEventListener("pageshow", () => setTimeout(fitReviewCanvas, 100));
window.addEventListener("focus", () => setTimeout(fitReviewCanvas, 100));

function drawReviewOverlay() {
  const ctx = document.getElementById("reviewOverlay").getContext("2d");
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Dynamische Skalierung für hochauflösende Canvas, damit die Anfasser auf dem Handy immer groß genug sind
  const scaleFactor = Math.max(ctx.canvas.width, ctx.canvas.height) / 1000;
  const outerRadius = 30 * scaleFactor;
  const innerRadius = 10 * scaleFactor;
  const strokeWidth = 4 * scaleFactor;

  // Grün schimmerndes Polygon
  ctx.beginPath();
  ctx.moveTo(reviewState.corners[0].x, reviewState.corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(reviewState.corners[i].x, reviewState.corners[i].y);
  ctx.closePath();
  ctx.lineWidth = Math.max(1, strokeWidth / 2); // Dünner, da man jetzt nah rangezoomt hat
  ctx.strokeStyle = "#28a745";
  ctx.fillStyle = "rgba(40, 167, 69, 0.15)";
  ctx.fill();
  ctx.stroke();

  // 4 Weiße Anfass-Punkte mit grünen Kernen
  reviewState.corners.forEach((c) => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, outerRadius, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fill();
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(c.x, c.y, innerRadius, 0, 2 * Math.PI);
    ctx.fillStyle = "#28a745";
    ctx.fill();
  });
}

// Touch & Mouse Handler für das Verschieben der Ecken
function getInternalPos(e) {
  const rect = reviewOverlay.getBoundingClientRect();
  const scaleX = reviewOverlay.width / rect.width;
  const scaleY = reviewOverlay.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function onDragStart(e) {
  e.preventDefault();
  const pos = getInternalPos(e);
  reviewState.activeCorner = -1;

  // Dynamischer Fangradius basierend auf der enormen HD-Pixelzahl der Leinwand
  const catchRadius = Math.max(reviewOverlay.width, reviewOverlay.height) * 0.08;

  for (let i = 0; i < 4; i++) {
    if (Math.hypot(reviewState.corners[i].x - pos.x, reviewState.corners[i].y - pos.y) < catchRadius) {
      reviewState.activeCorner = i;
      break;
    }
  }
}

function onDragMove(e) {
  if (reviewState.activeCorner === -1) return;
  e.preventDefault();
  const pos = getInternalPos(e);
  // Position clampen, damit Ecke nicht aus dem Zoom-Bild geschoben wird
  reviewState.corners[reviewState.activeCorner].x = Math.max(0, Math.min(reviewOverlay.width, pos.x));
  reviewState.corners[reviewState.activeCorner].y = Math.max(0, Math.min(reviewOverlay.height, pos.y));
  drawReviewOverlay();
}

function onDragEnd(e) {
  reviewState.activeCorner = -1;
}

reviewOverlay.addEventListener("mousedown", onDragStart);
reviewOverlay.addEventListener("mousemove", onDragMove);
reviewOverlay.addEventListener("mouseup", onDragEnd);
reviewOverlay.addEventListener("mouseleave", onDragEnd);
reviewOverlay.addEventListener("touchstart", onDragStart, { passive: false });
reviewOverlay.addEventListener("touchmove", onDragMove, { passive: false });
reviewOverlay.addEventListener("touchend", onDragEnd);

// Klick auf "Kantenerkennung wiederholen" -> Scannt das aktuelle Standbild noch einmal
const rescanBtn = document.getElementById("rescanBtn") || document.getElementById("manualRescanCornersBtn");
if (rescanBtn) {
  rescanBtn.addEventListener("click", async () => {
    if (!reviewState.highResCanvas) return;

    const orgBtnHtml = '<span class="material-symbols-outlined" style="font-size: 16px;">auto_fix_high</span> <span>Ecken neu erkennen</span>';
    rescanBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> <span style="font-size: 0.8rem;">Bitte warten...</span>`;
    rescanBtn.disabled = true;

    try {
      const refinedCorners = await performDetailedPostScan(reviewState.highResCanvas, null);
      if (refinedCorners && refinedCorners.length === 4) {
        reviewState.corners = refinedCorners.map((c) => ({
          x: Math.round(c.x * reviewState.highResCanvas.width - reviewState.cropX),
          y: Math.round(c.y * reviewState.highResCanvas.height - reviewState.cropY),
        }));
        drawReviewOverlay();
        updatePreviewFilter();
      } else {
        alert("Auf diesem Foto konnte kein eindeutiges Dokument erkannt werden. Bitte justiere die Kanten manuell.");
      }
    } catch (e) {
      console.error("Manueller Re-Scan fehlgeschlagen:", e);
    } finally {
      rescanBtn.innerHTML = orgBtnHtml;
      rescanBtn.disabled = false;
    }
  });
}

function updateConfirmBtnText() {
  const finishBtn = document.getElementById("finishScanBtn");
  if (!finishBtn) return;
  const count = scanPagesArray.length + 1;
  const icon = '<span class="material-symbols-outlined" style="font-size: 18px;">check_circle</span>';
  if (count > 1) {
    finishBtn.innerHTML = `${icon} <span>Abschließen (${count})</span>`;
  } else {
    finishBtn.innerHTML = `${icon} <span>Abschließen</span>`;
  }
}

// Aktualisiert den Mini-Vorschau Strip und die Buttons im Live-Kameramodus
function updateScannedPagesUI() {
  const strip = document.getElementById("scannedPagesStrip");
  const countBadge = document.getElementById("scannedCountBadge");
  const thumbsList = document.getElementById("scannedThumbsList");
  const captureBtn = document.getElementById("captureBtn");
  const stripFinishBtn = document.getElementById("stripFinishBtn");

  const count = scanPagesArray.length;

  if (count === 0) {
    if (strip) strip.style.display = "none";
    if (captureBtn) {
      captureBtn.title = "Dokument scannen";
      captureBtn.innerHTML = '<div class="shutter-inner"><span class="material-symbols-outlined">photo_camera</span></div>';
    }
  } else {
    if (strip) strip.style.display = "flex";
    if (countBadge) countBadge.innerText = count === 1 ? "1 Seite" : `${count} Seiten`;
    if (captureBtn) {
      captureBtn.title = `Seite ${count + 1} scannen`;
      captureBtn.innerHTML = '<div class="shutter-inner"><span class="material-symbols-outlined">photo_camera</span></div>';
    }
    if (stripFinishBtn) {
      stripFinishBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">check_circle</span> <span>Abschließen (${count})</span>`;
    }

    if (thumbsList) {
      thumbsList.innerHTML = "";
      scanPagesArray.forEach((item, index) => {
        const thumbDiv = document.createElement("div");
        thumbDiv.className = "scanned-thumb-item";
        thumbDiv.innerHTML = `
          <img src="${item.previewUrl}" alt="Seite ${index + 1}" />
          <span class="thumb-page-num">${index + 1}</span>
          <button class="thumb-delete-btn" title="Seite ${index + 1} entfernen" onclick="event.stopPropagation(); removeScannedPage(${index});">✕</button>
        `;
        thumbsList.appendChild(thumbDiv);
      });
    }
  }

  updateConfirmBtnText();
}

window.removeScannedPage = function (index) {
  if (index >= 0 && index < scanPagesArray.length) {
    if (scanPagesArray[index].previewUrl) {
      URL.revokeObjectURL(scanPagesArray[index].previewUrl);
    }
    scanPagesArray.splice(index, 1);
    updateScannedPagesUI();
  }
};

// Handler für Abbrechen / Schließen des Review-Panels (bricht nur den aktuellen Scan ab, behält vorherige Seiten)
const closeReviewPanel = async () => {
  const reviewSec = document.getElementById("manual-review-section");
  if (reviewSec) reviewSec.style.display = "none";
  const filterMenu = document.getElementById("filterMenu");
  if (filterMenu) filterMenu.style.display = "block";
  const vidWrap = document.getElementById("video-wrapper");
  if (vidWrap) vidWrap.style.display = "flex";
  if (captureBtn) {
    captureBtn.style.display = "block";
    captureBtn.disabled = false;
  }

  // WICHTIG: Bereits gespeicherte Seiten bleiben erhalten, nur der unbestätigte Snapshot wird verworfen
  reviewState.highResCanvas = null;
  updateScannedPagesUI();
  await resumeCameraAndInference();
};

const cancelCrossBtn = document.getElementById("cancelReviewCrossBtn");
if (cancelCrossBtn) cancelCrossBtn.addEventListener("click", closeReviewPanel);

const cancelReviewBtn = document.getElementById("cancelReviewBtn");
if (cancelReviewBtn) cancelReviewBtn.addEventListener("click", closeReviewPanel);

const downloadOnlyBtn = document.getElementById("downloadOnlyBtn");
if (downloadOnlyBtn) {
  downloadOnlyBtn.addEventListener("click", () => {
    finishScanProcess(false);
  });
}

const finishScanBtn = document.getElementById("finishScanBtn");
if (finishScanBtn) {
  finishScanBtn.addEventListener("click", () => {
    finishScanProcess(true);
  });
}

const discardScanBtn = document.getElementById("discardScanBtn");
if (discardScanBtn) discardScanBtn.addEventListener("click", closeReviewPanel);

function rotateReviewImage(clockwise = true) {
  if (!reviewState.highResCanvas) return;
  const oldCanvas = reviewState.highResCanvas;
  const oldW = oldCanvas.width;
  const oldH = oldCanvas.height;

  const newCanvas = document.createElement("canvas");
  newCanvas.width = oldH;
  newCanvas.height = oldW;
  const ctx = newCanvas.getContext("2d");

  ctx.translate(newCanvas.width / 2, newCanvas.height / 2);
  ctx.rotate((clockwise ? 90 : -90) * (Math.PI / 180));
  ctx.drawImage(oldCanvas, -oldW / 2, -oldH / 2);

  let absCorners = reviewState.corners.map((c) => {
    let absX = c.x + reviewState.cropX;
    let absY = c.y + reviewState.cropY;
    if (clockwise) {
      return { x: oldH - absY, y: absX };
    } else {
      return { x: absY, y: oldW - absX };
    }
  });

  absCorners = sortAndOrderCorners(absCorners);

  const relCorners = absCorners.map((c) => ({
    x: c.x / newCanvas.width,
    y: c.y / newCanvas.height,
  }));

  showManualReview(newCanvas, relCorners, true);
}

const rotateLeftBtn = document.getElementById("rotateReviewLeftBtn");
if (rotateLeftBtn) rotateLeftBtn.addEventListener("click", () => rotateReviewImage(false));

const rotateRightBtn = document.getElementById("rotateReviewRightBtn");
if (rotateRightBtn) rotateRightBtn.addEventListener("click", () => rotateReviewImage(true));

document.querySelectorAll(".filter-preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const filterType = btn.getAttribute("data-filter");
    const algInput = document.getElementById("algorithmSelect");
    let targetAlg = "auto";
    if (filterType === "photo" || filterType === "original") {
      targetAlg = "color";
    } else if (filterType === "color_doc") {
      targetAlg = "color_enhanced";
    } else if (filterType === "doc" || filterType === "clean") {
      targetAlg = "white_paper";
    } else if (filterType === "bw") {
      targetAlg = "bw_adaptive";
    }
    if (algInput) algInput.value = targetAlg;
    syncFilterPresetButtons(targetAlg);
    updatePreviewFilter();
  });
});

const stripFinishBtn = document.getElementById("stripFinishBtn");
if (stripFinishBtn) {
  stripFinishBtn.addEventListener("click", () => {
    reviewState.highResCanvas = null;
    finishScanProcess(true);
  });
}

function extractCroppedBlob() {
  return new Promise((resolve) => {
    try {
      // Rückrechnung der modifizierten lokalen Crop-Punkte auf das Originale Mega-Pixel-Speicherbild
      let finalAbsoluteCorners = reviewState.corners.map((c) => ({
        x: c.x + reviewState.cropX,
        y: c.y + reviewState.cropY,
      }));
      finalAbsoluteCorners = sortAndOrderCorners(finalAbsoluteCorners);

      let srcMat = cv.imread(reviewState.highResCanvas);
      let ptsArray = [];
      for (let i = 0; i < 4; i++) {
        ptsArray.push(finalAbsoluteCorners[i].x);
        ptsArray.push(finalAbsoluteCorners[i].y);
      }

      let [tlX, tlY, trX, trY, brX, brY, blX, blY] = ptsArray;

      let widthA = Math.sqrt(Math.pow(brX - blX, 2) + Math.pow(brY - blY, 2));
      let widthB = Math.sqrt(Math.pow(trX - tlX, 2) + Math.pow(trY - tlY, 2));
      let maxWidth = Math.round(Math.max(widthA, widthB));
      let heightA = Math.sqrt(Math.pow(trX - brX, 2) + Math.pow(trY - brY, 2));
      let heightB = Math.sqrt(Math.pow(tlX - blX, 2) + Math.pow(tlY - blY, 2));
      let maxHeight = Math.round(Math.max(heightA, heightB));

      let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, ptsArray);
      let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        maxWidth - 1,
        0,
        maxWidth - 1,
        maxHeight - 1,
        0,
        maxHeight - 1,
      ]);

      let M = cv.getPerspectiveTransform(srcTri, dstTri);
      let dstMat = new cv.Mat();
      let dsize = new cv.Size(maxWidth, maxHeight);

      cv.warpPerspective(srcMat, dstMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

      let finalImageCanvas = document.createElement("canvas");
      cv.imshow(finalImageCanvas, dstMat);
      srcMat.delete();
      dstMat.delete();
      M.delete();
      srcTri.delete();
      dstTri.delete();

      finalImageCanvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        "image/jpeg",
        0.95
      );
    } catch (e) {
      console.error("Fehler beim Croppen via OpenCV.JS, nutze Originalbild:", e);
      reviewState.highResCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
    }
  });
}

// Seite hinzufügen (nextPageBtn oder addPageBtn)
const handleAddPageAction = async () => {
  const reviewSec = document.getElementById("manual-review-section");
  if (reviewSec) reviewSec.style.display = "none";
  if (loader) loader.style.display = "block";
  if (loaderStatus) loaderStatus.innerText = "Seite zwischengespeichert. Mache Platz für die nächste...";

  const blob = await extractCroppedBlob();
  const previewUrl = URL.createObjectURL(blob);
  scanPagesArray.push({ blob, previewUrl });
  reviewState.highResCanvas = null;

  setTimeout(async () => {
    if (loader) loader.style.display = "none";
    const filterMenu = document.getElementById("filterMenu");
    if (filterMenu) filterMenu.style.display = "block";
    const vidWrap = document.getElementById("video-wrapper");
    if (vidWrap) vidWrap.style.display = "flex";
    if (captureBtn) {
      captureBtn.style.display = "block";
      captureBtn.disabled = false;
    }
    updateScannedPagesUI();
    await resumeCameraAndInference();
  }, 400);
};

const addPageBtn = document.getElementById("addPageBtn");
if (addPageBtn) addPageBtn.addEventListener("click", handleAddPageAction);

const nextPageBtn = document.getElementById("nextPageBtn");
if (nextPageBtn) nextPageBtn.addEventListener("click", handleAddPageAction);

// Klick auf "Abschließen" (KI) o. "Download" -> Abschließende Berechnung und Hochladen aller Seiten
async function finishScanProcess(sendToAI) {
  document.getElementById("manual-review-section").style.display = "none";
  loader.style.display = "block";
  loaderStatus.innerText = "Bereite Seiten vor...";

  let pagesToUpload = scanPagesArray.map((item) => item.blob);

  // Falls wir uns im Review-Screen befinden, die aktuelle Seite mit einbinden
  if (reviewState.highResCanvas) {
    const finalBlob = await extractCroppedBlob();
    pagesToUpload.push(finalBlob);
  }

  if (pagesToUpload.length === 0) {
    loader.style.display = "none";
    alert("Keine gescannten Seiten zum Abschließen vorhanden.");
    return;
  }

  // Canvas Array an Server API pushen
  const formData = new FormData();
  pagesToUpload.forEach((blob, index) => {
    formData.append("images", blob, `page_${index}.jpg`);
    formData.append("coords", "frontend_cropped");
  });

  formData.append("algorithm", document.getElementById("algorithmSelect").value);
  // KI Pipeline Flag basiert jetzt direkt auf dem aufgerufenen Button
  formData.append("autoQueue", sendToAI ? "true" : "false");

  // Non-blocking Toast als Feedback
  const toastId = "toast-" + Date.now();
  const toastHtml = `
            <div id="${toastId}" class="position-fixed start-50 translate-middle-x px-3 py-2 text-center" 
                style="top: 75px; z-index: 9999; width: max-content; max-width: 90vw; background: var(--md-sys-color-surface-container-high, #E7E0EC); color: var(--md-sys-color-on-surface, #1C1B1F); border-radius: var(--md-sys-shape-corner-extra-large, 28px); box-shadow: var(--md-sys-elevation-2); font-size: 14px; font-weight: 500; transition: all 0.3s ease;">
                🔄 verarbeite ${pagesToUpload.length} Seite(n)...
            </div>
        `;
  document.body.insertAdjacentHTML("beforeend", toastHtml);

  // Direkt UI freigeben, ohne auf fetch warten!
  loader.style.display = "none";
  document.getElementById("filterMenu").style.display = "block";
  document.getElementById("video-wrapper").style.display = "flex";
  document.getElementById("captureBtn").style.display = "block";
  document.getElementById("captureBtn").disabled = false;

  // Array leeren und Thumbnails revoken
  scanPagesArray.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  scanPagesArray = [];
  reviewState.highResCanvas = null;
  updateScannedPagesUI();
  await resumeCameraAndInference();

  // Der asynchrone Upload-Prozess im Hintergrund
  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      body: formData,
    });

    const toastEl = document.getElementById(toastId);

    if (response.ok) {
      const fileName = response.headers.get("X-File-Name");
      const autoJobHeader = response.headers.get("X-Auto-Job");
      const pdfBlob = await response.blob();

      // Nur beim "Download"-Button wird das PDF heruntergeladen
      if (!sendToAI) {
        const downloadUrl = window.URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `Scanned_Document_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      if (autoJobHeader && sendToAI) {
        try {
          const jobData = JSON.parse(autoJobHeader);
          // Backend verarbeitet den Job bereits und index.html empfängt es via Poll
          toastEl.innerText = "✅ KI Pipeline gestartet!";
        } catch (e) {
          toastEl.innerText = "❌ Fehler bei Server-Daten";
          toastEl.style.background = "#FFDAD6";
          toastEl.style.color = "#410002";
        }
      } else {
        toastEl.innerText = "✅ Lokal gesichert!";
      }

      toastEl.style.background = "#C4EED0";
      toastEl.style.color = "#003914";
      loadSavedScans();

      setTimeout(() => {
        toastEl.style.opacity = "0";
        setTimeout(() => toastEl.remove(), 300);
      }, 3000);
    } else {
      const errorData = await response.json();
      toastEl.innerText = "❌ " + (errorData.error || "Fehler");
      toastEl.style.background = "#FFDAD6";
      toastEl.style.color = "#410002";
      setTimeout(() => {
        toastEl.style.opacity = "0";
        setTimeout(() => toastEl.remove(), 300);
      }, 4000);
    }
  } catch (error) {
    const toastEl = document.getElementById(toastId);
    // Nur den Fehler-Toast anzeigen, wenn er existiert (also wenn nicht schon geschlossen)
    if (toastEl) {
      toastEl.innerText = "☁️ Im Hintergrund verarbeitet"; // Netzwerkfehler ist irreführend bei schnellem Verlassen der Seite (Fetch Aborting)
      toastEl.style.background = "#E7E0EC";
      toastEl.style.color = "#1C1B1F";
      setTimeout(() => {
        toastEl.style.opacity = "0";
        setTimeout(() => toastEl.remove(), 300);
      }, 3000);
    }
  }
}

// Service Worker registrieren (PWA Support)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => console.log("SW registered"))
      .catch((err) => console.log("SW registration failed:", err));
  });
}

// Initialisiere ONNX KI-Kantenerkennung bei Start
setupTapToFocus();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initOnnx();
  });
} else {
  initOnnx();
}
