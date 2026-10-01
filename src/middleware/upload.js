const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { DOWNLOADS_DIR } = require("../config/paths");
const { fixUmlauts } = require("../utils/textUtils");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    cb(null, DOWNLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = fixUmlauts(file.originalname);
    cb(null, Date.now() + "-" + path.basename(safeName.replace(/\\/g, "/")));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

module.exports = {
  upload,
};
