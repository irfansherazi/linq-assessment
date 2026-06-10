/**
 * Global test setup.
 * Sets minimal environment variables so modules that call env() don't throw.
 */
process.env.DATABASE_URL = "postgresql://mc@localhost:5432/candidateflow_test";
process.env.AUTH_SECRET = "test-secret-minimum-32-characters-long!!";
process.env.LINQ_API_KEY = "test-linq-api-key";
process.env.LINQ_FROM_PHONE = "+12125550001";
process.env.LINQ_WEBHOOK_SECRET = "whsec_dGVzdC1zZWNyZXQtZm9yLXRlc3Rpbmct";
// NODE_ENV is set by the test runner — do not reassign
