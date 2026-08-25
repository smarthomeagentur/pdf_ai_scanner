/**
 * @deprecated Legacy Server Gmail API Module.
 * Gmail Scanning has been fully migrated to client-side Zero-Trust GIS in `public/js/gmailScanner.js`.
 * No Gmail tokens are handled or stored on the server.
 */

module.exports = {
  isLegacy: true,
  migratedTo: "public/js/gmailScanner.js",
};
