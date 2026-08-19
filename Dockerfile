FROM node:20-bookworm

# System packages for pdf2pic, Playwright, Python and Tesseract OCR
RUN apt-get update && apt-get install -y \
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

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy ONNX Runtime WASM files from node_modules into the public vendor directory
# so the browser can load them without an external CDN dependency.
# Only the files needed for WASM execution are copied (no WebGL/WebGPU bloat).
RUN mkdir -p ./public/vendor/onnx && \
    cp node_modules/onnxruntime-web/dist/ort.min.js ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm ./public/vendor/onnx/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs ./public/vendor/onnx/

# Install Playwright browser and dependencies specifically for chromium
#RUN npx playwright install --with-deps chromium

# Copy application files (vendor/ from source is not needed, it was populated above)
COPY . .

# Download the ONNX document corner detection model if not already present
# Model: doc_corner_net.onnx (~4.8 MB) - only downloaded once per image build
RUN if [ ! -f ./public/models/doc_corner_net.onnx ]; then \
      mkdir -p ./public/models && \
      echo "ONNX model not found in COPY - please ensure public/models/doc_corner_net.onnx exists in build context"; \
    fi

# Expose the port the app runs on
EXPOSE 3000

# Start command
CMD ["npm", "start"]