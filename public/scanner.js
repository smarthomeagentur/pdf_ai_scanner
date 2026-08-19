const video = document.getElementById("video");
const sampleImage = document.getElementById("sampleImage");
const overlay = document.getElementById("overlay");
const ctxOverlay = overlay.getContext("2d");
const videoWrapper = document.getElementById("video-wrapper");
const captureBtn = document.getElementById("captureBtn");
const loader = document.getElementById("loader");
const loaderStatus = document.getElementById("loader-status");
const loadingText = document.getElementById("opencv-loading");

// --- Erkennungs-Engine State & Toggle ---
let currentEngine = localStorage.getItem("scanner_detection_engine") || "onnx";
let onnxSession = null;
let onnxLoading = false;
let onnxReady = false;
let onnxLoadFailed = false;
let openCvReady = false;
let cameraStarted = false;
let cvAutoEnabled = true;

// Bildquelle (Live Kamera oder Test-Bilder)
const sourceSelect = document.getElementById("sourceSelect");
let activeSource = "camera";

// UI Elements for Engine Toggle
const engineToggleBtn = document.getElementById("engineToggleBtn");
const modeIcon = document.getElementById("modeIcon");
const modeText = document.getElementById("modeText");
const modeSpinner = document.getElementById("modeSpinner");
const setModeOnnxBtn = document.getElementById("setModeOnnxBtn");
const setModeCvBtn = document.getElementById("setModeCvBtn");
const onnxSettingsNotice = document.getElementById("onnxSettingsNotice");
const cvSettingsGroup = document.getElementById("cvSettingsGroup");
const cvAutoThresholds = document.getElementById("cvAutoThresholds");
const cvManualSliders = document.getElementById("cvManualSliders");

function updateEngineUI() {
  if (currentEngine === "onnx") {
    if (onnxLoading) {
      if (engineToggleBtn) engineToggleBtn.className = "btn btn-sm btn-primary d-flex align-items-center justify-content-center gap-1 mode-toggle-btn";
      if (modeIcon) modeIcon.innerText = "psychology";
      if (modeText) modeText.innerText = "KI lädt...";
      if (modeSpinner) modeSpinner.style.display = "inline-block";
    } else if (onnxReady) {
      if (engineToggleBtn) engineToggleBtn.className = "btn btn-sm btn-primary d-flex align-items-center justify-content-center gap-1 mode-toggle-btn";
      if (modeIcon) modeIcon.innerText = "psychology";
      if (modeText) modeText.innerText = "KI: ONNX";
      if (modeSpinner) modeSpinner.style.display = "none";
    } else if (onnxLoadFailed) {
      if (engineToggleBtn) engineToggleBtn.className = "btn btn-sm btn-warning d-flex align-items-center justify-content-center gap-1 mode-toggle-btn";
      if (modeIcon) modeIcon.innerText = "warning";
      if (modeText) modeText.innerText = "KI Fehler (CV Fallback)";
      if (modeSpinner) modeSpinner.style.display = "none";
    }

    if (setModeOnnxBtn) setModeOnnxBtn.className = "btn btn-sm btn-primary w-50 d-flex align-items-center justify-content-center gap-1";
    if (setModeCvBtn) setModeCvBtn.className = "btn btn-sm btn-outline-secondary w-50 d-flex align-items-center justify-content-center gap-1";
    if (onnxSettingsNotice) onnxSettingsNotice.style.display = "flex";
    if (cvSettingsGroup) cvSettingsGroup.style.display = "none";
  } else {
    if (engineToggleBtn) engineToggleBtn.className = "btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-center gap-1 mode-toggle-btn";
    if (modeIcon) modeIcon.innerText = "crop_free";
    if (modeText) modeText.innerText = cvAutoEnabled ? "OpenCV (Auto)" : "OpenCV";
    if (modeSpinner) modeSpinner.style.display = "none";

    if (setModeOnnxBtn) setModeOnnxBtn.className = "btn btn-sm btn-outline-secondary w-50 d-flex align-items-center justify-content-center gap-1";
    if (setModeCvBtn) setModeCvBtn.className = "btn btn-sm btn-primary w-50 d-flex align-items-center justify-content-center gap-1";
    if (onnxSettingsNotice) onnxSettingsNotice.style.display = "none";
    if (cvSettingsGroup) cvSettingsGroup.style.display = "block";
  }
}

if (engineToggleBtn) {
  engineToggleBtn.addEventListener("click", () => {
    if (currentEngine === "onnx") {
      currentEngine = "cv";
    } else {
      currentEngine = "onnx";
      if (!onnxReady && !onnxLoading) initOnnx();
    }
    localStorage.setItem("scanner_detection_engine", currentEngine);
    updateEngineUI();
  });
}

if (setModeOnnxBtn) {
  setModeOnnxBtn.addEventListener("click", () => {
    currentEngine = "onnx";
    if (!onnxReady && !onnxLoading) initOnnx();
    localStorage.setItem("scanner_detection_engine", "onnx");
    updateEngineUI();
  });
}

if (setModeCvBtn) {
  setModeCvBtn.addEventListener("click", () => {
    currentEngine = "cv";
    localStorage.setItem("scanner_detection_engine", "cv");
    updateEngineUI();
  });
}

if (cvAutoThresholds) {
  cvAutoThresholds.addEventListener("change", (e) => {
    cvAutoEnabled = e.target.checked;
    if (cvManualSliders) cvManualSliders.style.display = cvAutoEnabled ? "none" : "block";
    updateEngineUI();
  });
}

// UI-Slider Handler
let optBlur = 3;
let optCanny1 = 40;
let optCanny2 = 125;

const sensitivitySlider = document.getElementById("sensitivitySlider");
if (sensitivitySlider) {
  sensitivitySlider.oninput = function () {
    let s = parseInt(this.value);
    document.getElementById("sensitivityVal").innerText = s + "%";
    let norm = s / 100.0;
    optBlur = norm > 0.8 ? 3 : norm > 0.4 ? 5 : norm > 0.2 ? 7 : 9;
    optCanny1 = 150 - Math.round(norm * 130);
    optCanny2 = 250 - Math.round(norm * 150);
  };
}

const smoothingSlider = document.getElementById("smoothingSlider");
if (smoothingSlider) {
  smoothingSlider.oninput = function () {
    SMOOTHING_FACTOR = parseInt(this.value) / 100.0;
    document.getElementById("smoothingVal").innerText = this.value + "%";
  };
}

let streaming = false;

// Für die Kanten-Detektion wird das Bild auf eine kleine Arbeitskopie reduziert (Performance!)
const processWidth = 320;
const processHeight = 240;
const canvasProcess = document.createElement("canvas");
canvasProcess.width = processWidth;
canvasProcess.height = processHeight;
const ctxProcess = canvasProcess.getContext("2d", { willReadFrequently: true });

// Dedicated 256x256 working canvas for ONNX inference
const canvasOnnx = document.createElement("canvas");
canvasOnnx.width = 256;
canvasOnnx.height = 256;
const ctxOnnx = canvasOnnx.getContext("2d", { willReadFrequently: true });
const onnxTensorBuffer = new Float32Array(3 * 256 * 256);
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

let src, gray, blurred, edges, contours, hierarchy;
let currentRelativeDocumentCorners = null;

let smoothedCornersRaw = null;
let framesWithoutDetection = 0;
const MAX_FRAMES_LOSE_TRACK = 12;
let SMOOTHING_FACTOR = 0.5;

function initCvMats() {
  if (typeof cv !== "undefined" && !src && typeof cv.Mat !== "undefined") {
    try {
      src = new cv.Mat(processHeight, processWidth, cv.CV_8UC4);
      gray = new cv.Mat();
      blurred = new cv.Mat();
      edges = new cv.Mat();
      hierarchy = new cv.Mat();
      contours = new cv.MatVector();
    } catch (e) {
      console.warn("Fehler beim Initialisieren der OpenCV Matrizen:", e);
    }
  }
}

// Hilfsfunktion, um die 4 Punkte in eine verlässliche Form zu Sortieren (Top-Left, Top-Right, Bottom-Right, Bottom-Left)
function sortAndOrderCorners(ptsData) {
  let pts = [];
  if (Array.isArray(ptsData) && typeof ptsData[0] === "object") {
    pts = ptsData.map((p) => ({ x: p.x, y: p.y }));
  } else {
    for (let i = 0; i < 4; i++) {
      pts.push({ x: ptsData[i * 2], y: ptsData[i * 2 + 1] });
    }
  }
  let cx = 0,
    cy = 0;
  pts.forEach((p) => {
    cx += p.x;
    cy += p.y;
  });
  cx /= 4;
  cy /= 4;

  return pts.sort((a, b) => {
    return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
  });
}

// --- ONNX Corner Detection ---
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

    let sumWeight = 0;
    let sumX = 0;
    let sumY = 0;

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ny = peakY + dy;
        const nx = peakX + dx;
        if (nx >= 0 && nx < mapW && ny >= 0 && ny < mapH) {
          const w = Math.max(0, heatmapData[channelOffset + ny * mapW + nx]);
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

    if (meanScore < 0.08 || minScore < 0.02) {
      return null;
    }

    const pts = corners;
    const area =
      0.5 *
      Math.abs(
        pts[0].x * (pts[1].y - pts[3].y) +
          pts[1].x * (pts[2].y - pts[0].y) +
          pts[2].x * (pts[3].y - pts[1].y) +
          pts[3].x * (pts[0].y - pts[2].y)
      );

    if (area < 0.04) {
      return null;
    }

    return corners;
  } catch (err) {
    console.error("ONNX Inferenzfehler:", err);
    return null;
  }
}

// --- OpenCV Corner Detection (Optimiert mit CLAHE & Auto-Canny) ---
function detectCornersCv(source, sx = 0, sy = 0, sWidth = null, sHeight = null, isHighRes = false) {
  if (!openCvReady || !src) return null;

  try {
    const sw = sWidth || source.videoWidth || source.naturalWidth || source.width;
    const sh = sHeight || source.videoHeight || source.naturalHeight || source.height;

    ctxProcess.drawImage(source, sx, sy, sw, sh, 0, 0, processWidth, processHeight);
    const imageData = ctxProcess.getImageData(0, 0, processWidth, processHeight);
    src.data.set(imageData.data);

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    let blurVal = optBlur;
    let c1 = optCanny1;
    let c2 = optCanny2;

    if (cvAutoEnabled) {
      try {
        let clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
        clahe.apply(gray, gray);
        clahe.delete();
      } catch (ce) {}

      let meanVal = cv.mean(gray)[0];
      c1 = Math.max(15, Math.floor(0.67 * meanVal));
      c2 = Math.min(240, Math.floor(1.33 * meanVal));
      blurVal = 5;
    }

    cv.GaussianBlur(gray, blurred, new cv.Size(blurVal, blurVal), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, c1, c2);

    let kernel = cv.Mat.ones(5, 5, cv.CV_8U);
    cv.dilate(edges, edges, kernel);
    cv.erode(edges, edges, kernel);
    kernel.delete();

    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let bestCnt = null;
    const minAreaThresh = isHighRes ? processWidth * processHeight * 0.03 : processWidth * processHeight * 0.05;

    function checkContoursList(cntList) {
      for (let i = 0; i < cntList.size(); ++i) {
        let cnt = cntList.get(i);
        let area = cv.contourArea(cnt);

        if (area > minAreaThresh) {
          let peri = cv.arcLength(cnt, true);
          let epsilons = isHighRes ? [0.015, 0.03, 0.05, 0.08, 0.12, 0.15] : [0.04, 0.07, 0.11];

          for (let eps of epsilons) {
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, eps * peri, true);

            if (approx.rows === 4 && area > maxArea && cv.isContourConvex(approx)) {
              let maxCosine = 0;
              for (let j = 2; j < 6; j++) {
                let pt1 = { x: approx.data32S[(j % 4) * 2], y: approx.data32S[(j % 4) * 2 + 1] };
                let pt2 = { x: approx.data32S[((j - 2) % 4) * 2], y: approx.data32S[((j - 2) % 4) * 2 + 1] };
                let pt0 = { x: approx.data32S[((j - 1) % 4) * 2], y: approx.data32S[((j - 1) % 4) * 2 + 1] };

                let dx1 = pt1.x - pt0.x;
                let dy1 = pt1.y - pt0.y;
                let dx2 = pt2.x - pt0.x;
                let dy2 = pt2.y - pt0.y;
                let cosine = Math.abs(
                  (dx1 * dx2 + dy1 * dy2) / Math.sqrt((dx1 * dx1 + dy1 * dy1) * (dx2 * dx2 + dy2 * dy2) + 1e-10)
                );
                maxCosine = Math.max(maxCosine, cosine);
              }

              const cosineMaxThresh = isHighRes ? 0.9 : 0.82;
              if (maxCosine < cosineMaxThresh) {
                maxArea = area;
                if (bestCnt) bestCnt.delete();
                bestCnt = approx.clone();
              }
            }
            approx.delete();
          }
        }
      }
    }

    checkContoursList(contours);

    if (isHighRes && !bestCnt) {
      let hFb = new cv.Mat();
      cv.threshold(gray, hFb, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      let dKernel = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.morphologyEx(hFb, hFb, cv.MORPH_CLOSE, dKernel);
      dKernel.delete();

      let fbC = new cv.MatVector();
      let fbH = new cv.Mat();
      cv.findContours(hFb, fbC, fbH, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      checkContoursList(fbC);
      fbC.delete();
      fbH.delete();
      hFb.delete();
    }

    if (bestCnt) {
      let sorted = sortAndOrderCorners(bestCnt.data32S);
      bestCnt.delete();
      return sorted.map((c) => ({
        x: c.x / processWidth,
        y: c.y / processHeight,
      }));
    }

    return null;
  } catch (err) {
    console.error("OpenCV Erkennungsfehler:", err);
    return null;
  }
}

// Initialisiere ONNX Runtime Web
async function initOnnx() {
  if (onnxLoading || onnxReady) return;
  onnxLoading = true;
  updateEngineUI();

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

    updateEngineUI();
    onSystemReady();
  } catch (err) {
    console.error("Fehler beim Laden von ONNX:", err);
    onnxLoading = false;
    onnxReady = false;
    onnxLoadFailed = true;
    updateEngineUI();
    onSystemReady();
  }
}

// Global hook für OpenCV Initialisierung
window.initOpenCvRuntime = function () {
  if (typeof cv !== "undefined") {
    if (cv.onRuntimeInitialized) {
      cv["onRuntimeInitialized"] = () => {
        console.log("OpenCV initialized");
        openCvReady = true;
        initCvMats();
        onSystemReady();
      };
    } else if (cv.Mat) {
      console.log("OpenCV already initialized");
      openCvReady = true;
      initCvMats();
      onSystemReady();
    }
  }
};
if (window.openCvIsLoaded) {
  window.initOpenCvRuntime();
}

let videoTrack = null;

async function initAutofocus() {
  if (!videoTrack) return;
  try {
    const capabilities = videoTrack.getCapabilities();
    if (capabilities.focusMode && capabilities.focusMode.includes("continuous")) {
      await videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      console.log("Kontinuierlicher Autofokus initialisiert");
    }
  } catch (e) {
    console.warn("Autofokus konnte nicht initialisiert werden:", e);
  }
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
          '<span class="material-symbols-outlined pb-1">flashlight_off</span><small style="font-size:8px">Aus</small>';
        torchBtn.classList.remove("btn-warning", "btn-primary");
        torchBtn.classList.add("btn-outline-secondary");
        torchBtn.style.color = "#333";
        torchBtn.style.backgroundColor = "rgba(255,255,255,0.8)";
      } else if (torchMode === "on") {
        await videoTrack.applyConstraints({ advanced: [{ torch: true }] });
        torchBtn.innerHTML =
          '<span class="material-symbols-outlined pb-1">flashlight_on</span><small style="font-size:8px">An</small>';
        torchBtn.classList.remove("btn-outline-secondary", "btn-primary");
        torchBtn.classList.add("btn-warning");
        torchBtn.style.color = "#000";
        torchBtn.style.backgroundColor = "";
      } else if (torchMode === "auto") {
        await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
        torchBtn.innerHTML =
          '<span class="material-symbols-outlined pb-1">flashlight_on</span><small style="font-size:8px">Auto</small>';
        torchBtn.classList.remove("btn-outline-secondary", "btn-warning");
        torchBtn.classList.add("btn-primary");
        torchBtn.style.color = "#fff";
        torchBtn.style.backgroundColor = "";
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
let autoCaptureEnabled = true;
let documentDetectionStart = 0;
let countdownInterval = null;
let autoCaptureTriggered = false;

if (autoCaptureBtn) {
  autoCaptureBtn.addEventListener("click", () => {
    autoCaptureEnabled = !autoCaptureEnabled;
    if (autoCaptureEnabled) {
      autoCaptureBtn.classList.replace("btn-outline-secondary", "btn-primary");
      autoCaptureBtn.innerHTML = '<span class="material-symbols-outlined">document_scanner</span> <span>Auto: An</span>';
    } else {
      autoCaptureBtn.classList.replace("btn-primary", "btn-outline-secondary");
      autoCaptureBtn.innerHTML = '<span class="material-symbols-outlined">document_scanner</span> <span>Auto: Aus</span>';
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

// Kamera & Video Stream Management
async function startCamera() {
  if (sampleImage) sampleImage.style.display = "none";
  if (video) video.style.display = "block";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    });
    video.srcObject = stream;
    videoTrack = stream.getVideoTracks()[0];
    video.play();
    updateTorchState();
    await initAutofocus();
  } catch (err) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      video.srcObject = stream;
      videoTrack = stream.getVideoTracks()[0];
      video.play();
      updateTorchState();
      await initAutofocus();
    } catch (fallbackErr) {
      console.warn("Kamera konnte nicht gestartet werden (z. B. auf Desktop/Test). Schalte automatisch auf Test-Bild 'edge1.jpg' um.", fallbackErr);
      if (sourceSelect) sourceSelect.value = "edge1.jpg";
      activeSource = "edge1.jpg";
      loadSampleImage("edge1.jpg");
    }
  }
}

// Test-Bild Loader für Entwicklungs- & Testpipeline
function loadSampleImage(filename) {
  if (videoTrack) {
    try {
      videoTrack.stop();
      videoTrack = null;
    } catch (e) {}
  }
  if (video) video.style.display = "none";
  if (sampleImage) {
    sampleImage.style.display = "block";
    sampleImage.src = "/samples-scanner/" + filename;
    sampleImage.onload = () => {
      console.log(`Test-Bild '${filename}' geladen (${sampleImage.naturalWidth}x${sampleImage.naturalHeight})`);
      const rect = videoWrapper.getBoundingClientRect();
      overlay.width = rect.width;
      overlay.height = rect.height;
      streaming = true;
      captureBtn.disabled = false;
      smoothedCornersRaw = null;
      framesWithoutDetection = 0;

      initCvMats();
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
  if (!cameraStarted && (onnxReady || openCvReady || onnxLoadFailed)) {
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
  if (!streaming && video.videoWidth > 0 && activeSource === "camera") {
    const rect = video.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    streaming = true;
    captureBtn.disabled = false;

    window.addEventListener("resize", () => {
      if (streaming && (video || sampleImage)) {
        const newRect = videoWrapper.getBoundingClientRect();
        overlay.width = newRect.width;
        overlay.height = newRect.height;
      }
    });

    initCvMats();
    requestAnimationFrame(processVideo);
  }
});

let isProcessingFrame = false;

async function processVideo() {
  if (!streaming) return;

  if (isProcessingFrame) {
    setTimeout(() => requestAnimationFrame(processVideo), 30);
    return;
  }

  isProcessingFrame = true;

  try {
    const currentSource = activeSource === "camera" ? video : sampleImage;
    if (!currentSource || (activeSource === "camera" && (!video.videoWidth || video.readyState < 2))) {
      isProcessingFrame = false;
      setTimeout(() => requestAnimationFrame(processVideo), 50);
      return;
    }

    const rect = videoWrapper.getBoundingClientRect();
    const srcW = activeSource === "camera" ? video.videoWidth : (sampleImage.naturalWidth || 800);
    const srcH = activeSource === "camera" ? video.videoHeight : (sampleImage.naturalHeight || 600);

    const wScale = srcW / rect.width;
    const hScale = srcH / rect.height;
    const scale = Math.min(wScale, hScale);

    const sWidth = rect.width * scale;
    const sHeight = rect.height * scale;
    const sx = Math.max(0, (srcW - sWidth) / 2);
    const sy = Math.max(0, (srcH - sHeight) / 2);

    let detectedCorners = null;

    // 1. Priorisiere die aktive Engine
    if (currentEngine === "onnx") {
      if (onnxReady) {
        detectedCorners = await detectCornersOnnx(currentSource, sx, sy, sWidth, sHeight);
      }
      if (!detectedCorners && openCvReady) {
        detectedCorners = detectCornersCv(currentSource, sx, sy, sWidth, sHeight, false);
      }
    } else {
      if (openCvReady) {
        detectedCorners = detectCornersCv(currentSource, sx, sy, sWidth, sHeight, false);
      } else if (onnxReady) {
        detectedCorners = await detectCornersOnnx(currentSource, sx, sy, sWidth, sHeight);
      }
    }

    // --- SMOOTHING / ANTI-FLICKERING LOGIK ---
    if (detectedCorners && detectedCorners.length === 4) {
      framesWithoutDetection = 0;
      let sortedNewCorners = sortAndOrderCorners(detectedCorners);

      if (!smoothedCornersRaw) {
        smoothedCornersRaw = sortedNewCorners;
      } else {
        for (let i = 0; i < 4; i++) {
          smoothedCornersRaw[i].x =
            smoothedCornersRaw[i].x * (1 - SMOOTHING_FACTOR) + sortedNewCorners[i].x * SMOOTHING_FACTOR;
          smoothedCornersRaw[i].y =
            smoothedCornersRaw[i].y * (1 - SMOOTHING_FACTOR) + sortedNewCorners[i].y * SMOOTHING_FACTOR;
        }
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
      framesWithoutDetection++;

      if (autoCaptureTriggered && framesWithoutDetection > 7) {
        cancelAutoCountdown();
      }

      if (framesWithoutDetection > MAX_FRAMES_LOSE_TRACK) {
        smoothedCornersRaw = null;
        cancelAutoCountdown();
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
    } else {
      currentRelativeDocumentCorners = null;
    }
  } catch (err) {
    console.error("Frame-Verarbeitung Fehler:", err);
  } finally {
    isProcessingFrame = false;
  }

  // Nächster Frame Timer (35ms für flüssige ~25-30 FPS)
  setTimeout(() => {
    requestAnimationFrame(processVideo);
  }, 35);
}

captureBtn.addEventListener("click", async () => {
  if (!streaming) return;

  document.getElementById("algorithmSelect").value = "auto";
  document.getElementById("previewAlgorithmSelect").value = "auto";

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
      let focusWasTriggered = false;
      try {
        const imageCapture = new ImageCapture(videoTrack);
        const capabilities = videoTrack.getCapabilities();
        const advancedConstraints = [];

        if (capabilities.focusMode && capabilities.focusMode.includes("manual")) {
          advancedConstraints.push({ focusMode: "manual" });
          focusWasTriggered = true;
        }

        if (torchSupported && torchMode === "auto") {
          advancedConstraints.push({ torch: true });
          flashWasTriggered = true;
        }

        if (advancedConstraints.length > 0) {
          await videoTrack.applyConstraints({ advanced: advancedConstraints });
          const waitTime = flashWasTriggered ? 400 : 0;
          if (waitTime > 0) {
            await new Promise((r) => setTimeout(r, waitTime));
          }
        }

        const imageBitmap = await imageCapture.grabFrame();
        highResBitmap = imageBitmap;
        originalWidth = imageBitmap.width;
        originalHeight = imageBitmap.height;
        photoWasUsed = true;
      } catch (e) {
        console.warn("Fotofunktion nicht per API abrufbar, falle zurück auf Video Capture", e);
      } finally {
        if (videoTrack) {
          try {
            const restoreConstraints = [];
            if (flashWasTriggered) restoreConstraints.push({ torch: false });
            if (focusWasTriggered) restoreConstraints.push({ focusMode: "continuous" });
            if (restoreConstraints.length > 0) await videoTrack.applyConstraints({ advanced: restoreConstraints });
          } catch (restoreErr) {}
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
      const rect = videoWrapper.getBoundingClientRect();
      const vidW = activeSource === "camera" ? video.videoWidth : sampleImage.naturalWidth;
      const vidH = activeSource === "camera" ? video.videoHeight : sampleImage.naturalHeight;

      const wScaleDOM = vidW / rect.width;
      const hScaleDOM = vidH / rect.height;
      const scaleDOM = Math.min(wScaleDOM, hScaleDOM);

      const visibleVidW = rect.width * scaleDOM;
      const visibleVidH = rect.height * scaleDOM;
      const domOffsetX = (vidW - visibleVidW) / 2;
      const domOffsetY = (vidH - visibleVidH) / 2;

      const scaleVidToPhoto = Math.min(originalWidth / vidW, originalHeight / vidH);
      const mappedVidW = vidW * scaleVidToPhoto;
      const mappedVidH = vidH * scaleVidToPhoto;

      const photoOffsetX = (originalWidth - mappedVidW) / 2;
      const photoOffsetY = (originalHeight - mappedVidH) / 2;

      frozenCorners = frozenCorners.map((fc) => {
        let absVideoX = domOffsetX + fc.x * visibleVidW;
        let absVideoY = domOffsetY + fc.y * visibleVidH;
        let absPhotoX = photoOffsetX + absVideoX * scaleVidToPhoto;
        let absPhotoY = photoOffsetY + absVideoY * scaleVidToPhoto;
        return {
          x: absPhotoX / originalWidth,
          y: absPhotoY / originalHeight,
        };
      });
    }
  } else {
    let cropWidth = originalWidth;
    let cropHeight = originalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (streaming && video) {
      const rect = video.getBoundingClientRect();
      const vScale = Math.min(originalWidth / rect.width, originalHeight / rect.height);
      cropWidth = rect.width * vScale;
      cropHeight = rect.height * vScale;
      sourceX = (originalWidth - cropWidth) / 2;
      sourceY = (originalHeight - cropHeight) / 2;
    }

    canvasHighRes.width = cropWidth;
    canvasHighRes.height = cropHeight;
    ctxHighRes.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  }

  let hasRealCorners = !!frozenCorners;
  // Falls absolut kein Dokument gefunden
  if (!frozenCorners) {
    frozenCorners = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    // Automatischen Filter-Request stoppen, da wir keine Kanten haben
    document.getElementById("previewLoadingText").style.display = "none";
  } else {
    // Kanten gefunden -> Starte Preload
    document.getElementById("previewLoadingText").style.display = "block";
  }

  // --- RESCAN AUF DEM FERTIGEN HOCHAUFLÖSENDEN FOTO ---
  // ONNX wird immer zuerst versucht (unabhängig vom Live-Modus).
  // Hinweis: ONNX skaliert intern immer auf 256×256 – HighRes-Canvas hat daher
  // keinen direkten Auflösungsvorteil, aber das vollständige Bild ohne
  // Vorschau-Crop liefert trotzdem bessere Ergebnisse als der Live-Frame.
  // OpenCV arbeitet intern auf 320×240 und profitiert bei isHighRes=true
  // von lockereren Epsilon-Werten und dem Otsu-Fallback.
  try {
    let postScanCorners = null;

    if (onnxReady) {
      // Gesamtes Foto übergeben (sx=0, sy=0, volle Abmessungen)
      postScanCorners = await detectCornersOnnx(
        canvasHighRes, 0, 0, canvasHighRes.width, canvasHighRes.height
      );
    }

    if (!postScanCorners && openCvReady) {
      postScanCorners = detectCornersCv(canvasHighRes, 0, 0, canvasHighRes.width, canvasHighRes.height, true);
    }

    if (postScanCorners && postScanCorners.length === 4) {
      frozenCorners = sortAndOrderCorners(postScanCorners);
      hasRealCorners = true;
      console.log("Erfolgreicher Post-Scan auf Rohfoto!");
    }
  } catch (e) {
    console.error("Post-Scan fehlgeschlagen, arbeite mit Video-Koordinaten weiter:", e);
  }

  // Wenn am Ende immer noch keine gültigen Ecken vorliegen
  // bestCntRaw is block scoped, handle it here safely
  // hasRealCorners is already managed above
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

function updatePreviewFilter() {
  const filter = document.getElementById("algorithmSelect").value;
  const rCv = document.getElementById("reviewCanvas");

  // Zuerst immer das originale(ungefilterte), um 15% erweiterte Bild zurückholen
  if (!reviewState.highResCanvas) return;
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

  rCv.style.filter = "none"; // CSS-Reset (falls es alte Testsachen gäbe)

  // Original überspringt alles und behält einfach das ungefilterte High-Res Segment
  if (filter === "color") {
    return;
  }

  // Optisches Feedback, dass es lädt (Kein "Blurry Image" Effekt mehr)
  document.getElementById("previewLoadingText").style.display = "block";

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
        if (filter === "auto" && detectedAlgorithm) {
          const selectEl = document.getElementById("previewAlgorithmSelect");
          selectEl.value = detectedAlgorithm;
          document.getElementById("algorithmSelect").value = detectedAlgorithm;
        }

        const imgBlob = await response.blob();
        const url = URL.createObjectURL(imgBlob);

        const img = new Image();
        img.onload = () => {
          rCv.getContext("2d").drawImage(img, 0, 0, reviewState.cropW, reviewState.cropH);
          document.getElementById("previewLoadingText").style.display = "none";
          URL.revokeObjectURL(url);
        };
        img.src = url;
      } catch (err) {
        console.error("Preview Fehler: ", err);
        document.getElementById("previewLoadingText").style.display = "none";
      }
    },
    "image/jpeg",
    0.85
  );
}

function showManualReview(highResCanvas, relativeCorners, hasRealCorners = true) {
  // Pausiere Kameraanzeige
  document.getElementById("video-wrapper").style.display = "none";
  document.getElementById("captureBtn").style.display = "none";
  document.getElementById("captureBtn").disabled = true;
  document.getElementById("filterMenu").style.display = "none";
  document.getElementById("manual-review-section").style.display = "flex";
  // Wenn man in den Review kommt, Auto-Tracking unbedingt zurücksetzen:
  cancelAutoCountdown();
  updateConfirmBtnText();

  reviewState.highResCanvas = highResCanvas;

  // Finde die absoluten Grenzen (Min/Max X und Y) der markierten Ecken im Originalbild, um den Rand zu berechnen
  let xs = relativeCorners.map((c) => c.x * highResCanvas.width);
  let ys = relativeCorners.map((c) => c.y * highResCanvas.height);
  let minX = Math.min(...xs),
    maxX = Math.max(...xs);
  let minY = Math.min(...ys),
    maxY = Math.max(...ys);

  // Füge 15% Puffer um den erkannten Rahmen hinzu, damit der User noch etwas "außerhalb" sieht
  let padX = (maxX - minX) * 0.15;
  let padY = (maxY - minY) * 0.15;

  reviewState.cropX = Math.max(0, minX - padX);
  reviewState.cropY = Math.max(0, minY - padY);
  reviewState.cropW = Math.min(highResCanvas.width - reviewState.cropX, maxX - minX + 2 * padX);
  reviewState.cropH = Math.min(highResCanvas.height - reviewState.cropY, maxY - minY + 2 * padY);

  // Lade diesen Puffer-Zuschnitt in den ReviewCanvas
  const rCv = document.getElementById("reviewCanvas");
  rCv.width = reviewState.cropW;
  rCv.height = reviewState.cropH;
  rCv
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

  // Passe Overlay (Zeichenfläche) exakt auf das Canvas an
  const oCv = document.getElementById("reviewOverlay");
  oCv.width = reviewState.cropW;
  oCv.height = reviewState.cropH;

  // Rechne die 4 Originalecken in das lokale (abgeschnittene) Review-Bild um
  reviewState.corners = relativeCorners.map((c) => ({
    x: c.x * highResCanvas.width - reviewState.cropX,
    y: c.y * highResCanvas.height - reviewState.cropY,
  }));

  // Sync preview combo box with global config
  document.getElementById("previewAlgorithmSelect").value = document.getElementById("algorithmSelect").value;

  // Vermeide den Preview-Lader, falls ohnehin keine klaren Kanten erkannt wurden
  if (hasRealCorners) {
    updatePreviewFilter();
  } else {
    document.getElementById("previewLoadingText").style.display = "none";
  }

  drawReviewOverlay();
}

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
const reviewOverlay = document.getElementById("reviewOverlay");

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
document.getElementById("rescanBtn").addEventListener("click", async () => {
  if (!reviewState.highResCanvas) return;

  const orgBtnHtml = '<span class="material-symbols-outlined" style="font-size: 18px;">crop</span> <span>Kantenerkennung</span>';
  document.getElementById("rescanBtn").innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> <span style="font-size: 0.8rem;">Bitte warten...</span>`;
  document.getElementById("rescanBtn").disabled = true;

  try {
    let neueEcken = null;

    let tCanvas = document.createElement("canvas");
    tCanvas.width = reviewState.cropW;
    tCanvas.height = reviewState.cropH;
    let tCtx = tCanvas.getContext("2d", { willReadFrequently: true });
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = "high";

    tCtx.drawImage(
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

    if (onnxReady) {
      neueEcken = await detectCornersOnnx(tCanvas);
    }

    if (!neueEcken && openCvReady) {
      neueEcken = detectCornersCv(tCanvas, 0, 0, reviewState.cropW, reviewState.cropH, true);
    }

    if (neueEcken && neueEcken.length === 4) {
      reviewState.corners = neueEcken.map((c) => ({
        x: c.x * reviewState.cropW,
        y: c.y * reviewState.cropH,
      }));
      drawReviewOverlay();
      updatePreviewFilter();
    } else {
      alert("Auf diesem Foto konnte kein eindeutiges Dokument erkannt werden. Bitte justiere die Kanten manuell.");
    }
  } catch (e) {
    console.error("Manueller Re-Scan fehlgeschlagen:", e);
  } finally {
    document.getElementById("rescanBtn").innerHTML = orgBtnHtml;
    document.getElementById("rescanBtn").disabled = false;
  }
});

function updateConfirmBtnText() {
  const finishBtn = document.getElementById("finishScanBtn");
  if (!finishBtn) return;
  const count = scanPagesArray.length + 1;
  const icon = '<span class="material-symbols-outlined" style="font-size: 20px;">check_circle</span>';
  if (count > 1) {
    finishBtn.innerHTML = `${icon} <span>Abschließen (${count} Seiten)</span>`;
  } else {
    finishBtn.innerHTML = `${icon} <span>Abschließen</span>`;
  }
}

// Event Listener für den neuen Schließen-Button am Panel-Rand
document.getElementById("cancelReviewCrossBtn").addEventListener("click", () => {
  document.getElementById("manual-review-section").style.display = "none";
  document.getElementById("filterMenu").style.display = "block";
  document.getElementById("video-wrapper").style.display = "flex";
  document.getElementById("captureBtn").style.display = "block";
  document.getElementById("captureBtn").disabled = false;

  scanPagesArray = []; // Alle gesammelten Seiten resetten
  updateConfirmBtnText();
});

// Neu hinzugefügter DownloadBtn Handler
document.getElementById("downloadOnlyBtn").addEventListener("click", () => {
  finishScanProcess(false);
});

// Neu hinzugefügter Finish-KI Btn Handler
document.getElementById("finishScanBtn").addEventListener("click", () => {
  finishScanProcess(true);
});

function extractCroppedBlob() {
  return new Promise((resolve) => {
    try {
      // Rückrechnung der modifizierten lokalen Crop-Punkte auf das Originale Mega-Pixel-Speicherbild
      let finalAbsoluteCorners = reviewState.corners.map((c) => ({
        x: c.x + reviewState.cropX,
        y: c.y + reviewState.cropY,
      }));

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

// Neu: Als Seite zwischenspeichern
document.getElementById("addPageBtn").addEventListener("click", async () => {
  document.getElementById("manual-review-section").style.display = "none";
  loader.style.display = "block";
  loaderStatus.innerText = "Seite zwischengespeichert. Mache Platz für die nächste...";

  const blob = await extractCroppedBlob();
  scanPagesArray.push(blob);

  setTimeout(() => {
    loader.style.display = "none";
    document.getElementById("filterMenu").style.display = "block";
    document.getElementById("video-wrapper").style.display = "flex";
    document.getElementById("captureBtn").style.display = "block";
    document.getElementById("captureBtn").disabled = false;
    updateConfirmBtnText();
  }, 500);
});

// Klick auf "Abschließen" (KI) o. "Download" -> Abschließende Berechnung und Hochladen aller Seiten
async function finishScanProcess(sendToAI) {
  document.getElementById("manual-review-section").style.display = "none";
  loader.style.display = "block";
  loaderStatus.innerText = "Bereite Seiten vor...";

  const finalBlob = await extractCroppedBlob();
  scanPagesArray.push(finalBlob);

  // Canvas Array an Server API pushen
  const formData = new FormData();
  scanPagesArray.forEach((blob, index) => {
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
                🔄 verarbeite ${scanPagesArray.length} Seite(n)...
            </div>
        `;
  document.body.insertAdjacentHTML("beforeend", toastHtml);

  // Direkt UI freigeben, ohne auf fetch warten!
  loader.style.display = "none";
  document.getElementById("filterMenu").style.display = "block";
  document.getElementById("video-wrapper").style.display = "flex";
  document.getElementById("captureBtn").style.display = "block";
  document.getElementById("captureBtn").disabled = false;

  // Letzte Aufräum-Schritte, damit man fröhlich weiterscannen kann
  scanPagesArray = [];

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

// Initialisiere Engine & ONNX bei Start
updateEngineUI();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    updateEngineUI();
    initOnnx();
  });
} else {
  initOnnx();
}
