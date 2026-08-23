import { createServer } from "http";
import { attachTranslatorWebSocket } from "./routes/translator";
import app from "./app";
import { logger } from "./lib/logger";
import { db, usersTable, pool } from "@workspace/db";
import { isNotNull, sql } from "drizzle-orm";
import { StreamChat } from "stream-chat";
import { startTronMonitor } from "./services/tron-monitor";

/** Idempotent migration: crypto_deposits table (auto-detected USDT TRC20). */
async function runCryptoDepositsMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crypto_deposits (
        id                     SERIAL PRIMARY KEY,
        user_id                INTEGER NOT NULL,
        amount                 NUMERIC(18,6) NOT NULL,
        received_amount        NUMERIC(18,6),
        currency               TEXT NOT NULL DEFAULT 'USDT',
        network                TEXT NOT NULL DEFAULT 'TRC20',
        deposit_address        TEXT NOT NULL,
        transaction_hash       TEXT,
        from_address           TEXT,
        status                 TEXT NOT NULL DEFAULT 'waiting',
        confirmations          INTEGER NOT NULL DEFAULT 0,
        required_confirmations INTEGER NOT NULL DEFAULT 20,
        wallet_id              INTEGER,
        note                   TEXT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        confirmed_at           TIMESTAMPTZ,
        expires_at             TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS crypto_deposits_tx_hash_unique
        ON crypto_deposits(transaction_hash) WHERE transaction_hash IS NOT NULL;
    `);
    logger.info("Crypto deposits schema migration complete");
  } catch (err) {
    logger.error({ err }, "Crypto deposits migration FAILED");
  }
}

/** Idempotent migration: crypto_payments table. */
async function runCryptoSchemaMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crypto_payments (
        id                     SERIAL PRIMARY KEY,
        sender_id              INTEGER NOT NULL,
        receiver_address       TEXT NOT NULL,
        sender_wallet_address  TEXT,
        wallet_type            TEXT,
        amount                 NUMERIC(18,8) NOT NULL,
        currency               TEXT NOT NULL DEFAULT 'USDT',
        network                TEXT NOT NULL DEFAULT 'TRC20',
        payment_method         TEXT NOT NULL,
        transaction_hash       TEXT,
        status                 TEXT NOT NULL DEFAULT 'waiting_for_payment',
        confirmations          INTEGER NOT NULL DEFAULT 0,
        required_confirmations INTEGER NOT NULL DEFAULT 20,
        note                   TEXT,
        admin_note             TEXT,
        payment_method_id      INTEGER,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at           TIMESTAMPTZ,
        expires_at             TIMESTAMPTZ
      );
    `);
    // Duplicate-credit prevention: one on-chain tx can only ever complete one payment
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS crypto_payments_tx_hash_unique
        ON crypto_payments (transaction_hash)
        WHERE transaction_hash IS NOT NULL;
    `);
    logger.info("Crypto payments schema migration complete");
  } catch (err) {
    logger.error({ err }, "Crypto schema migration FAILED");
  }
}

/** Idempotent migration: add KYC columns that were introduced in this release. */
async function runKycSchemaMigration() {
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'unverified',
        ADD COLUMN IF NOT EXISTS kyc_document_path TEXT,
        ADD COLUMN IF NOT EXISTS kyc_selfie_path TEXT,
        ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT,
        ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ;
    `);
    logger.info("KYC schema migration complete (IF NOT EXISTS — safe to run repeatedly)");
  } catch (err) {
    logger.error({ err }, "KYC schema migration FAILED — KYC routes will not work correctly");
  }
}

/** Idempotent migration: profile personalization columns (avatar + chat wallpaper). */
async function runProfilePersonalizationMigration() {
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS avatar_path TEXT,
        ADD COLUMN IF NOT EXISTS chat_background TEXT,
        ADD COLUMN IF NOT EXISTS chat_background_path TEXT;
    `);
    logger.info("Profile personalization schema migration complete");
  } catch (err) {
    logger.error({ err }, "Profile personalization migration FAILED — avatar/wallpaper routes will not work correctly");
  }
}

/** Idempotent migration: chat_wallpapers catalog table + seed of built-in presets. */
async function runWallpaperCatalogMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_wallpapers (
        slug TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        css TEXT,
        image_file TEXT,
        image_path TEXT,
        official BOOLEAN NOT NULL DEFAULT FALSE,
        sort INTEGER NOT NULL DEFAULT 100,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM chat_wallpapers`);
    if (rows[0].n === 0) {
      // Seed the built-in presets (image files live in the web app's public/wallpapers/)
      const seed: [string, string, string | null, string | null, boolean, number][] = [
        // slug, label, css, image_file, official, sort
        ["royal-classic", "Royal Classic", "#0b0d1a", "royal-classic.jpg", true, 1],
        ["nano-glow",    "Nano Glow",    "#160b33", "nano-glow.png",    true, 2],
        ["wave-flow",    "Wave Flow",    "#120a2e", "wave-flow.png",    true, 3],
        ["hexa-tech",    "Hexa Tech",    "#150d35", "hexa-tech.png",    true, 4],
        ["luxe-marble",  "Luxe Marble",  "#1d1040", "luxe-marble.png",  true, 5],
        ["cosmic-orbit", "Cosmic Orbit", "#0e0827", "cosmic-orbit.png", true, 6],
        ["aurora-mesh",  "Aurora Mesh",  "#140c31", "aurora-mesh.png",  true, 7],
        ["default",  "Classic",  "radial-gradient(1200px 500px at 80% -10%, hsl(217 60% 16% / 0.55), transparent 60%), radial-gradient(900px 420px at 0% 110%, hsl(262 55% 18% / 0.45), transparent 60%), linear-gradient(180deg, hsl(222 45% 7%), hsl(224 42% 9%))", null, false, 10],
        ["aurora",   "Aurora",   "radial-gradient(800px 400px at 20% 0%, hsl(160 80% 30% / 0.35), transparent 60%), radial-gradient(700px 500px at 90% 30%, hsl(190 90% 35% / 0.3), transparent 55%), radial-gradient(900px 500px at 50% 110%, hsl(260 70% 30% / 0.4), transparent 60%), linear-gradient(180deg, hsl(222 50% 6%), hsl(230 45% 9%))", null, false, 11],
        ["midnight", "Midnight", "radial-gradient(1000px 600px at 50% -20%, hsl(230 70% 20% / 0.6), transparent 65%), linear-gradient(180deg, hsl(232 55% 5%), hsl(240 45% 8%))", null, false, 12],
        ["sunset",   "Sunset",   "radial-gradient(900px 500px at 80% -10%, hsl(15 85% 35% / 0.4), transparent 60%), radial-gradient(700px 400px at 10% 100%, hsl(320 65% 30% / 0.35), transparent 60%), linear-gradient(180deg, hsl(255 40% 8%), hsl(275 40% 9%))", null, false, 13],
        ["ocean",    "Ocean",    "radial-gradient(1000px 500px at 70% -10%, hsl(200 90% 30% / 0.45), transparent 60%), radial-gradient(800px 500px at 10% 110%, hsl(220 80% 25% / 0.5), transparent 60%), linear-gradient(180deg, hsl(212 60% 6%), hsl(216 55% 9%))", null, false, 14],
        ["forest",   "Forest",   "radial-gradient(900px 500px at 85% 0%, hsl(150 60% 22% / 0.45), transparent 60%), radial-gradient(700px 450px at 5% 100%, hsl(120 45% 18% / 0.4), transparent 60%), linear-gradient(180deg, hsl(160 40% 5%), hsl(170 35% 8%))", null, false, 15],
        ["royal",    "Royal",    "radial-gradient(900px 500px at 75% -10%, hsl(268 75% 32% / 0.45), transparent 60%), radial-gradient(800px 500px at 10% 110%, hsl(290 60% 25% / 0.4), transparent 60%), linear-gradient(180deg, hsl(260 45% 7%), hsl(268 40% 9%))", null, false, 16],
        ["blush",    "Blush",    "radial-gradient(900px 500px at 80% -10%, hsl(340 70% 35% / 0.35), transparent 60%), radial-gradient(700px 450px at 5% 110%, hsl(20 75% 32% / 0.3), transparent 60%), linear-gradient(180deg, hsl(335 35% 7%), hsl(350 30% 9%))", null, false, 17],
        ["dots",     "Dots",     "radial-gradient(#1a1a1a 1px, transparent 1px) 0 0 / 20px 20px #0f0f0f", null, false, 18],
        ["graphite", "Graphite", "#16181c", "graphite.png", false, 19],
        ["slate",    "Slate",    "#111",    "slate.png",    false, 20],
        ["noir",     "Noir",     "#0a0c12", "noir.png",     false, 21],
      ];
      for (const [slug, label, css, imageFile, official, sort] of seed) {
        await pool.query(
          `INSERT INTO chat_wallpapers (slug, label, css, image_file, official, sort)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING`,
          [slug, label, css, imageFile, official, sort],
        );
      }
      logger.info("Seeded chat_wallpapers with built-in presets");
    }
    logger.info("Wallpaper catalog migration complete");
  } catch (err) {
    logger.error({ err }, "Wallpaper catalog migration FAILED — wallpaper picker will fall back to built-ins");
  }
}

/** Idempotent migration: email verification columns (existing users defaulted to verified). */
async function runEmailVerificationMigration() {
  try {
    await pool.query(`
      -- Add with DEFAULT TRUE so all existing users stay verified (not locked out)
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS email_verification_code TEXT,
        ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;
    `);
    logger.info("Email verification schema migration complete");
  } catch (err) {
    logger.error({ err }, "Email verification schema migration FAILED");
  }
}

/** Idempotent migration: push_subscriptions table for call notifications. */
/** Idempotent migration: live translation preferences. */
async function runTranslationPreferencesMigration() {
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en',
        ADD COLUMN IF NOT EXISTS translation_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    logger.info("Translation preferences schema migration complete");
  } catch (err) {
    logger.error({ err }, "Translation preferences migration FAILED");
  }
}

async function runPushSchemaMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    logger.info("Push subscriptions schema migration OK");
  } catch (err) {
    logger.error({ err }, "Push subscriptions schema migration FAILED");
  }
}

/** Idempotent migration: optional catalog displayed in active calls. */
async function runLiveServicesMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_services (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        business_name TEXT,
        image_url TEXT,
        cta_label TEXT,
        cta_url TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort INTEGER NOT NULL DEFAULT 100,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    logger.info("Live services catalog migration complete");
  } catch (err) {
    logger.error({ err }, "Live services catalog migration FAILED");
  }
}

/** Idempotent migration: fraud_events table, user lockout columns, tx USD amount column. */
async function runFraudSchemaMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fraud_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        event_type TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS send_locked_until TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS failed_transfer_attempts TEXT NOT NULL DEFAULT '0',
        ADD COLUMN IF NOT EXISTS last_failed_transfer_at TIMESTAMPTZ;

      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS from_amount_usd NUMERIC(18,4);
    `);
    logger.info("Fraud schema migration complete (IF NOT EXISTS — safe to run repeatedly)");
  } catch (err) {
    logger.error({ err }, "Fraud schema migration FAILED — velocity limits will not work correctly");
  }
}

/** One-time migration: clear legacy plain-text PINs (passwordHash already holds the bcrypt hash). */
async function clearLegacyPlainPins() {
  try {
    const result = await db
      .update(usersTable)
      .set({ plainPin: null })
      .where(isNotNull(usersTable.plainPin));
    logger.info("Cleared legacy plain-text PINs");
  } catch (err) {
    logger.warn({ err }, "plainPin migration failed (non-fatal)");
  }
}

/** One-time startup sync: push all DB users into Stream so everyone is searchable. */
async function syncUsersToStream() {
  try {
    const key = process.env.STREAM_API_KEY;
    const secret = process.env.STREAM_API_SECRET;
    if (!key || !secret) return;
    const client = StreamChat.getInstance(key, secret);
    const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
    if (users.length === 0) return;
    // Stream upsertUsers accepts up to 100 at a time
    for (let i = 0; i < users.length; i += 100) {
      const batch = users.slice(i, i + 100).map(u => ({
        id: String(u.id),
        name: u.name,
        ...(u.phone ? { phone: u.phone } : {}),
      }));
      await client.upsertUsers(batch);
    }
    logger.info({ count: users.length }, "Synced users to Stream Chat");
  } catch (err) {
    logger.warn({ err }, "Stream user sync failed (non-fatal)");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

attachTranslatorWebSocket(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");

  // Fire-and-forget async startup tasks
  (async () => {
    // Run idempotent schema migrations first — safe on every boot (IF NOT EXISTS)
    await runCryptoDepositsMigration();
    await runCryptoSchemaMigration();
    await runKycSchemaMigration();
    await runProfilePersonalizationMigration();
    await runWallpaperCatalogMigration();
    await runEmailVerificationMigration();
    await runFraudSchemaMigration();
    await runTranslationPreferencesMigration();
    await runPushSchemaMigration();
    await runLiveServicesMigration();
    // Clear any legacy plain-text PINs (bcrypt hash is in passwordHash)
    clearLegacyPlainPins();
    // Sync all existing DB users into Stream so they're searchable
    syncUsersToStream();
    // Start TRON blockchain monitor for automatic USDT TRC20 deposit detection
    startTronMonitor();
  })();
});
