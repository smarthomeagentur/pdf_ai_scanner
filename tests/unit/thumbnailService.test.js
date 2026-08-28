const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { getOrGenerateThumbnailPath } = require("../../src/services/fileRenderService");
const { DOWNLOADS_DIR } = require("../../src/config/paths");

test("fileRenderService - getOrGenerateThumbnailPath & Disk Caching", async (t) => {
  await t.test("returns null when identifier is empty or missing", async () => {
    const res = await getOrGenerateThumbnailPath(null, null);
    assert.equal(res, null);
  });

  await t.test("immediately returns existing local thumbnail from disk cache", async () => {
    const testId = "test_cache_dummy_id_123";
    const testThumbPath = path.join(DOWNLOADS_DIR, `thumb_${testId}.jpg`);

    // Create a mock thumbnail in downloads
    await fs.promises.writeFile(testThumbPath, Buffer.from("dummy-jpeg-data"));

    try {
      const resolvedPath = await getOrGenerateThumbnailPath(testId, null);
      assert.equal(resolvedPath, testThumbPath);
    } finally {
      await fs.promises.unlink(testThumbPath).catch(() => {});
    }
  });

  await t.test("returns null if neither local file nor Drive ID is present", async () => {
    const testId = "non_existent_doc_id_999";
    const mockGetJob = () => ({ id: testId, filePath: "downloads/non_existent.pdf" });

    const resolvedPath = await getOrGenerateThumbnailPath(testId, mockGetJob);
    assert.equal(resolvedPath, null);
  });
});
