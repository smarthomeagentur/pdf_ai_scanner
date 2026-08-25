FROM node:20-bookworm

# System packages for pdf2pic, Python, OCR, SQLite and native C++ builds
RUN apt-get update && apt-get install -y \
    build-essential \
    sqlite3 \
    graphicsmagick \
    ghostscript \
    poppler-utils \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    xdg-utils \
    python3 \
    python3-dev \
    python3-venv \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
    ocrmypdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Python Virtual Environment and install dependencies
RUN python3 -m venv ./venv && \
    ./venv/bin/pip install --no-cache-dir opencv-python-headless numpy pytesseract pymupdf

# Copy package files and install dependencies with native rebuild
COPY package*.json ./
RUN npm install && npm rebuild better-sqlite3 --build-from-source

# Copy ONNX Runtime WASM files from node_modules into the public vendor directory
# so the browser can load them without an external CDN dependency.
# Only the files needed for WASM execution are copied (no WebGL/WebGPU bloat).
RUN mkdir -p ./public/vendor/onnx && \
    cp node_modules/onnxruntime-web/dist/ort.min.js ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs ./public/vendor/onnx/

# Copy application files
COPY . .

# Download the ONNX document corner detection model if not already present
# Model: doc_corner_net.onnx (~4.8 MB) - only downloaded once per image build
RUN if [ ! -f ./public/models/doc_corner_net.onnx ]; then \
      mkdir -p ./public/models && \
      echo "ONNX model not found in COPY - please ensure public/models/doc_corner_net.onnx exists in build context"; \
    fi

# Persist store (database.sqlite, tokens) and downloads across Coolify deployments
VOLUME ["/app/store", "/app/downloads"]

# Expose the port the app runs on
EXPOSE 3000

# Start command
CMD ["npm", "start"]