import { execSync } from 'child_process'

const TEST_DB_URL = 'postgresql://postgres:pass@localhost:5432/smartpark_test'

// Runs once in a separate process before any test worker starts.
// Creates the test DB schema; idempotent on repeated runs.
export async function setup(): Promise<void> {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  })
}

export async function teardown(): Promise<void> {}
