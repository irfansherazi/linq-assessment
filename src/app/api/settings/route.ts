/**
 * GET /api/settings — return provisioned Linq phone number + webhook status
 */
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getLinqClient } from "@/lib/linq/client";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (_req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  let phoneNumbers: Array<{
    id: string;
    phone_number: string;
    health_status: { status: string };
  }> = [];

  let webhookSubscriptions: Array<{
    id: string;
    target_url: string;
    subscribed_events: string[];
  }> = [];

  try {
    const client = getLinqClient();
    const [numbersRes, webhooksRes] = await Promise.all([
      client.getPhoneNumbers(),
      client.listWebhookSubscriptions(),
    ]);
    phoneNumbers = numbersRes.phone_numbers;
    webhookSubscriptions = webhooksRes.webhook_subscriptions;
  } catch (err) {
    logger.warn({ msg: "Failed to fetch Linq settings", error: err instanceof Error ? err.message : String(err) });
  }

  return successResponse({
    linq: {
      fromPhone: process.env.LINQ_FROM_PHONE ?? null,
      phoneNumbers,
      webhookSubscriptions,
      webhookConfigured: !!process.env.LINQ_WEBHOOK_SECRET,
    },
  });
});
