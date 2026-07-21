// The ONE place the database connection is created. Every other file imports
// `prisma` from here — never constructs its own client.
//
// Why a singleton? In dev, Next.js hot-reloads your code on every save. If we
// did `new PrismaClient()` inside each file, every reload would open a fresh
// pool of DB connections and eventually exhaust them. Stashing the client on
// `globalThis` means it survives reloads and we reuse the same one.

// Next.js loads .env automatically for the app itself, but standalone
// `tsx scripts/*.mts` runs don't go through Next.js at all — without this
// they silently fall back to the local sqlite file even when Turso
// credentials are sitting right there in .env. Safe to call unconditionally;
// dotenv no-ops for anything already set (e.g. inside the Next.js process).
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Prisma 7 requires a driver adapter. Turso (libSQL) is what production talks
// to — it's SQLite-compatible, so the schema's `provider = "sqlite"` doesn't
// change, only which adapter class handles the connection. Local dev falls
// back to the plain file-based adapter when Turso env vars aren't set, so
// `npm run dev` still works offline without needing a Turso database.
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

const adapter =
  TURSO_URL && TURSO_TOKEN
    ? new PrismaLibSql({ url: TURSO_URL, authToken: TURSO_TOKEN })
    : new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });

// TypeScript-friendly handle on the global object to cache the client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
