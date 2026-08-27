const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/server");
const { JWT_SECRET } = require("../../src/config/secrets");
const { loadJobs, uploadJobs } = require("../../src/services/jobQueueService");
const { sampleJob1, sampleJobPrivate } = require("../helpers/mockData");

function createTokenCookie(role = "user") {
  const token = jwt.sign({ role }, JWT_SECRET, { expiresIn: "1h" });
  return `auth_token=${token}`;
}

test("Integration - Job Routes (/api/status & /api/jobs/*)", async (t) => {
  // Ensure DB & state loading has finished before seeding test jobs
  await loadJobs();
  uploadJobs[sampleJob1.id] = sampleJob1;
  uploadJobs[sampleJobPrivate.id] = sampleJobPrivate;

  await t.test("GET /api/status returns job list and identifies non-admin context", async () => {
    const res = await request(app).get("/api/status");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.isAdmin, false);
    assert.ok(Array.isArray(res.body.statuses));
  });

  await t.test("GET /api/status confirms admin context when admin cookie is provided", async () => {
    const adminCookie = createTokenCookie("admin");
    const res = await request(app).get("/api/status").set("Cookie", [adminCookie]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.isAdmin, true);
  });

  await t.test("GET /api/jobs/:id/file denies non-admin access to private job files", async () => {
    const res = await request(app).get(`/api/jobs/${sampleJobPrivate.id}/file`);
    assert.equal(res.status, 403);
  });

  await t.test("GET /api/jobs/:id/file blocks path traversal if job path points outside DOWNLOADS_DIR", async () => {
    // Inject a rogue job with path traversal
    const maliciousJobId = "rogue-job-traversal";
    uploadJobs[maliciousJobId] = {
      id: maliciousJobId,
      originalName: "malicious.pdf",
      filePath: "/etc/passwd",
      isPrivate: false,
    };

    const res = await request(app).get(`/api/jobs/${maliciousJobId}/file`);
    assert.equal(res.status, 403);
  });
});
