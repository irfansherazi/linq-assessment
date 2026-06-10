/**
 * Linq webhook subscription setup script.
 *
 * Creates a webhook subscription for a given public URL and stores the
 * signing secret in your local .env.local file.
 *
 * IMPORTANT: The signing_secret is only returned at subscription creation time.
 * This script captures it automatically.
 *
 * Usage:
 *   npm run linq:webhook:setup -- https://your-tunnel.ngrok.io
 *
 * For local development with ngrok:
 *   ngrok http 3000
 *   npm run linq:webhook:setup -- https://xxxx-xx-xx-xx.ngrok-free.app
 *
 * For local development with cloudflared:
 *   cloudflared tunnel --url http://localhost:3000
 *   npm run linq:webhook:setup -- https://xxxx.trycloudflare.com
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import fs from "fs";
import path from "path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import { LinqClient } from "../src/lib/linq/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const SUBSCRIBED_EVENTS = [
  "message.sent",
  "message.received",
  "message.delivered",
  "message.failed",
  "message.read",
];

async function setup() {
  const publicUrl = process.argv[2];

  if (!publicUrl) {
    console.error("Usage: npm run linq:webhook:setup -- <public-url>");
    console.error("Example: npm run linq:webhook:setup -- https://xxxx.ngrok-free.app");
    process.exit(1);
  }

  const webhookUrl = `${publicUrl.replace(/\/$/, "")}/api/webhooks/linq`;

  const apiKey = process.env.LINQ_API_KEY;
  if (!apiKey) {
    console.error("Error: LINQ_API_KEY is not set in .env.local");
    process.exit(1);
  }

  console.log("\n🔗 CandidateFlow — Linq Webhook Setup\n");
  console.log(`  API Key: ${apiKey.slice(0, 8)}...`);
  console.log(`  Webhook URL: ${webhookUrl}\n`);

  const client = new LinqClient({
    apiKey,
    baseUrl: process.env.LINQ_API_BASE_URL,
  });

  // ── List existing subscriptions ──────────────────────────────────
  console.log("  Checking existing subscriptions...");
  let existingSubscriptions: Array<{ id: string; target_url: string }> = [];
  try {
    const list = await client.listWebhookSubscriptions();
    existingSubscriptions = list.webhook_subscriptions ?? [];
    console.log(`  Found ${existingSubscriptions.length} existing subscription(s)`);
  } catch (err) {
    console.warn("  Warning: Could not list subscriptions:", err instanceof Error ? err.message : String(err));
  }

  // ── Delete conflicting subscription for same URL ─────────────────
  const conflicting = existingSubscriptions.find(
    (s) => s.target_url === webhookUrl
  );
  if (conflicting) {
    console.log(`  Removing existing subscription for this URL (id: ${conflicting.id})...`);
    try {
      await client.deleteWebhookSubscription(conflicting.id);
      console.log("  ✓ Removed");
    } catch (err) {
      console.warn("  Warning: Could not remove:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── Create new subscription ──────────────────────────────────────
  console.log("\n  Creating webhook subscription...");
  let subscription: { id: string; signing_secret: string };
  try {
    subscription = await client.createWebhookSubscription({
      target_url: webhookUrl,
      subscribed_events: SUBSCRIBED_EVENTS,
    });
    console.log(`  ✓ Created subscription (id: ${subscription.id})`);
    console.log(`  ✓ Signing secret: ${subscription.signing_secret.slice(0, 12)}...`);
  } catch (err) {
    console.error(
      "  Error creating subscription:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  // ── Write to .env.local ──────────────────────────────────────────
  const envPath = path.join(process.cwd(), ".env.local");
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

  // Update or append each key
  const updates: Record<string, string> = {
    LINQ_WEBHOOK_SECRET: subscription.signing_secret,
    LINQ_WEBHOOK_SUBSCRIPTION_ID: subscription.id,
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}="${value}"`;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, line);
    } else {
      envContent += `\n${line}`;
    }
  }

  fs.writeFileSync(envPath, envContent);

  console.log("\n  ✓ Updated .env.local with webhook credentials");
  console.log("\n✅ Setup complete!\n");
  console.log("  Next steps:");
  console.log("  1. Restart your dev server: npm run dev");
  console.log("  2. Test by sending an SMS to your Linq number");
  console.log(`\n  Subscribed events: ${SUBSCRIBED_EVENTS.join(", ")}\n`);
}

setup()
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
