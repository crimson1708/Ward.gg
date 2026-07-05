// The ONE place the database connection is created. Every other file imports
// `prisma` from here — never constructs its own client.
//
// Why a singleton? In dev, Next.js hot-reloads your code on every save. If we
// did `new PrismaClient()` inside each file, every reload would open a fresh
// pool of DB connections and eventually exhaust them. Stashing the client on
// `globalThis` means it survives reloads and we reuse the same one.

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./dev.db";

// Prisma 7 requires a driver adapter; for SQLite this points at the dev.db file.
const adapter = new PrismaBetterSqlite3({ url: DATABASE_URL });

// TypeScript-friendly handle on the global object to cache the client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
