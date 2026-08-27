/**
 * Global test environment setup.
 * Guarantees NODE_ENV is 'test' to enforce in-memory SQLite isolation,
 * and sets up deterministic authentication secrets for test suites.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_ENABLED = "true";
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test_jwt_secret_for_automated_ci_test_pipeline_32chars";
}
if (!process.env.APP_PASSWORD) {
  process.env.APP_PASSWORD = "test_app_password_mock_123";
}
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = "test_admin_password_mock_123";
}
