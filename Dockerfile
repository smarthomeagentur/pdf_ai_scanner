FROM node:20-bookworm

# System packages for pdf2pic, Playwright, Python and Tesseract OCR
RUN apt-get update && apt-get install -y \
    graphicsmagick \
    ghostscript \
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Python Virtual Environment and install dependencies
RUN python3 -m venv ./venv && \
    ./venv/bin/pip install --no-cache-dir opencv-python-headless numpy pytesseract

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install Playwright browser and dependencies specifically for chromium
#RUN npx playwright install --with-deps chromium

# Copy application files
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start command
CMD ["npm", "start"]