/**
 * Prisma client singleton — Prisma 7 driver-adapter pattern.
 *
 * Prisma 7 mandates a driver adapter for direct database connections.
 * We use @prisma/adapter-pg (the official PostgreSQL adapter).
 *
 * Next.js hot-reload creates new module instances in development,
 * which would exhaust the connection pool. We cache the client on
 * globalThis in non-production environments.
 */
import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { dbLogger } from "@/lib/logger";

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("[db] DATABASE_URL environment variable is not set");
  }

  // Pin the database session to UTC. The columns are `timestamptz`, and the
  // pg adapter sends Date params as naive (offset-less) UTC wall-clock strings;
  // Postgres then applies the *session* timezone when storing them. If the
  // server's session timezone isn't UTC (e.g. a local Postgres defaulting to
  // America/New_York), writes land shifted by that offset. Forcing the session
  // to UTC makes reads and writes correct regardless of server configuration.
  // (Vercel/most hosts already run UTC; this guarantees it everywhere.)
  const adapter = new PrismaPg({
    connectionString,
    options: "-c timezone=UTC",
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Log slow queries in development via Prisma extensions
if (process.env.NODE_ENV === "development") {
  dbLogger.debug({ msg: "Prisma client initialized (development mode)" });
}
