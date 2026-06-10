"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Phone,
  Globe,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatPhone, cn } from "@/lib/utils";

interface PhoneNumber {
  id: string;
  phone_number: string;
  health_status: { status: string };
}

interface WebhookSubscription {
  id: string;
  target_url: string;
  subscribed_events: string[];
}

interface SettingsData {
  linq: {
    fromPhone: string | null;
    phoneNumbers: PhoneNumber[];
    webhookSubscriptions: WebhookSubscription[];
    webhookConfigured: boolean;
  };
}

function SectionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function HealthDot({ status }: { status: string }) {
  const isHealthy = status?.toLowerCase() === "active" || status?.toLowerCase() === "healthy";
  return (
    <span
      className={`inline-flex h-2 w-2 rounded-full ${isHealthy ? "bg-green-500" : "bg-zinc-300"}`}
    />
  );
}

export default function SettingsPage() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery<{ data: SettingsData }>({
    queryKey: ["settings"],
    queryFn: () => fetch("/api/settings").then((r) => r.json()),
  });

  const linq = data?.data?.linq;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          View your Linq integration configuration and status.
        </p>
      </div>

      {/* Error state */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">Failed to load settings.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-red-200 text-red-700 hover:bg-red-100"
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Retry
          </Button>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="space-y-6"
      >
        {/* Linq Phone Numbers */}
        <div className="rounded-xl border border-zinc-200 bg-white">
          <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <Phone className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                Phone Numbers
              </h2>
              <p className="text-xs text-zinc-500">
                Linq provisioned numbers for this account
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="ml-auto h-7 text-xs text-zinc-400 hover:text-zinc-900"
            >
              <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            </Button>
          </div>

          <div className="divide-y divide-zinc-50 px-5">
            {isLoading ? (
              <div className="py-4">
                <SectionSkeleton />
              </div>
            ) : !linq?.phoneNumbers?.length ? (
              <div className="py-8 text-center">
                <Phone className="mx-auto h-7 w-7 text-zinc-300" />
                <p className="mt-2 text-sm text-zinc-500">No phone numbers provisioned</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Contact Linq support to provision a number.
                </p>
              </div>
            ) : (
              linq.phoneNumbers.map((num) => (
                <div
                  key={num.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <HealthDot status={num.health_status?.status ?? ""} />
                    <div>
                      <p className="font-mono text-sm font-medium text-zinc-900">
                        {formatPhone(num.phone_number)}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {num.health_status?.status ?? "Unknown"}
                      </p>
                    </div>
                  </div>
                  {linq.fromPhone === num.phone_number && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Default
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {linq?.fromPhone && (
            <>
              <Separator className="mx-5" />
              <div className="px-5 py-3">
                <p className="text-xs text-zinc-500">
                  Active outbound number:{" "}
                  <span className="font-mono font-medium text-zinc-900">
                    {formatPhone(linq.fromPhone)}
                  </span>
                </p>
              </div>
            </>
          )}
        </div>

        {/* Webhook Subscriptions */}
        <div className="rounded-xl border border-zinc-200 bg-white">
          <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
              <Webhook className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                Webhook Subscriptions
              </h2>
              <p className="text-xs text-zinc-500">
                Active Linq webhook event subscriptions
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {!isLoading && linq && (
                linq.webhookConfigured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    <CheckCircle2 className="h-3 w-3" />
                    Secret configured
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                    <XCircle className="h-3 w-3" />
                    Secret missing
                  </span>
                )
              )}
            </div>
          </div>

          <div className="divide-y divide-zinc-50 px-5">
            {isLoading ? (
              <div className="py-4">
                <SectionSkeleton />
              </div>
            ) : !linq?.webhookSubscriptions?.length ? (
              <div className="py-8 text-center">
                <Globe className="mx-auto h-7 w-7 text-zinc-300" />
                <p className="mt-2 text-sm text-zinc-500">No webhook subscriptions</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Configure webhook subscriptions in your Linq dashboard.
                </p>
              </div>
            ) : (
              linq.webhookSubscriptions.map((sub) => (
                <div key={sub.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-zinc-700">
                        {sub.target_url}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {sub.subscribed_events.map((event) => (
                          <span
                            key={event}
                            className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600"
                          >
                            {event}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Environment info */}
        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900">
            Environment
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Node environment</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700">
                {process.env.NODE_ENV ?? "unknown"}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
