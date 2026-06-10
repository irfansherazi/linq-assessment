"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, Activity, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";
import type { AuditLog } from "@/types";
import { MetricCard, MetricCardSkeleton } from "@/components/metric-card";

interface DashboardMetrics {
  totalCandidates: number;
  activeScreenings: number;
  completedScreenings: number;
  failedDeliveries: number;
}

interface ActivityLog extends AuditLog {
  candidate: { id: string; name: string } | null;
  actor: { name: string; email: string } | null;
}

interface DashboardData {
  metrics: DashboardMetrics;
  recentActivity: ActivityLog[];
}

const METRIC_CARDS = [
  {
    key: "totalCandidates" as const,
    label: "Total Candidates",
    icon: Users,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    key: "activeScreenings" as const,
    label: "Active Screenings",
    icon: Activity,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  {
    key: "completedScreenings" as const,
    label: "Completed Screenings",
    icon: CheckCircle2,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    key: "failedDeliveries" as const,
    label: "Failed Deliveries",
    icon: AlertTriangle,
    color: "text-red-600",
    bg: "bg-red-50",
  },
];

function ActivityRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3">
      <Skeleton className="h-7 w-7 rounded-full" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

function EmptyActivity() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Activity className="h-8 w-8 text-zinc-300" />
      <p className="mt-3 text-sm font-medium text-zinc-500">No recent activity</p>
      <p className="mt-1 text-xs text-zinc-400">
        Activity will appear here as you use CandidateFlow.
      </p>
    </div>
  );
}

const ACTION_COLORS: Record<string, string> = {
  CANDIDATE_CREATED: "bg-blue-50 text-blue-700",
  CANDIDATE_UPDATED: "bg-zinc-100 text-zinc-700",
  CANDIDATE_DELETED: "bg-red-50 text-red-700",
  SCREENING_STARTED: "bg-amber-50 text-amber-700",
  SCREENING_COMPLETED: "bg-green-50 text-green-700",
  SCREENING_FAILED: "bg-red-50 text-red-700",
  MESSAGE_SENT: "bg-blue-50 text-blue-700",
  MESSAGE_DELIVERED: "bg-green-50 text-green-700",
  MESSAGE_FAILED: "bg-red-50 text-red-700",
  MESSAGE_RECEIVED: "bg-purple-50 text-purple-700",
  RETRY_ENQUEUED: "bg-amber-50 text-amber-700",
  RETRY_SUCCEEDED: "bg-green-50 text-green-700",
  RETRY_DEAD_LETTERED: "bg-red-50 text-red-700",
};

const ACTION_ICONS: Record<string, string> = {
  CANDIDATE_CREATED: "👤",
  CANDIDATE_UPDATED: "✏️",
  CANDIDATE_DELETED: "🗑️",
  SCREENING_STARTED: "▶️",
  SCREENING_COMPLETED: "✅",
  SCREENING_FAILED: "❌",
  MESSAGE_SENT: "📤",
  MESSAGE_FAILED: "⚠️",
  RETRY_ENQUEUED: "🔁",
};

function activityDescription(log: ActivityLog): string {
  const meta = log.metadata as Record<string, unknown> | null;
  const candidate = log.candidate?.name ?? (meta?.name as string | undefined) ?? "Unknown";
  switch (log.action) {
    case "CANDIDATE_CREATED": return `${candidate} added as a candidate`;
    case "CANDIDATE_UPDATED": return `${candidate}'s profile updated`;
    case "CANDIDATE_DELETED": return `${candidate} was deleted`;
    case "SCREENING_STARTED": return `Screening started for ${candidate}`;
    case "SCREENING_COMPLETED": return `Screening completed for ${candidate}`;
    case "SCREENING_FAILED": {
      const reason = meta?.reason as string | undefined;
      return `Screening failed for ${candidate}${reason ? ` — ${reason}` : ""}`;
    }
    case "MESSAGE_SENT": return `Message sent to ${candidate}`;
    case "MESSAGE_FAILED": {
      const reason = meta?.errorReason as string | undefined;
      return `Message failed for ${candidate}${reason ? ` — ${reason}` : ""}`;
    }
    case "RETRY_ENQUEUED": return `Retry #${meta?.attempt ?? "?"} enqueued for ${candidate}`;
    case "RETRY_DEAD_LETTERED": return `Message dead-lettered for ${candidate} after ${meta?.totalAttempts ?? "?"} attempts`;
    default:
      return log.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

export default function DashboardPage() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery<{ data: DashboardData }>({
    queryKey: ["dashboard"],
    queryFn: () => fetch("/api/dashboard").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const metrics = data?.data?.metrics;
  const recentActivity = data?.data?.recentActivity ?? [];

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Overview of your recruiting pipeline.
        </p>
      </div>

      {/* Error state */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">Failed to load dashboard data.</p>
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

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <MetricCardSkeleton key={i} />
            ))
          : METRIC_CARDS.map((card, i) => (
              <motion.div
                key={card.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.05, ease: "easeOut" }}
              >
                <MetricCard
                  title={card.label}
                  value={metrics?.[card.key] ?? 0}
                  icon={<card.icon className={`h-5 w-5 ${card.color}`} />}
                />
              </motion.div>
            ))}
      </div>

      {/* Recent activity */}
      <div className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900">
            Recent Activity
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="h-7 text-xs text-zinc-500 hover:text-zinc-900"
          >
            <RefreshCw className={cn("mr-1 h-3 w-3 transition-transform", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="divide-y divide-zinc-50 px-5 max-h-105 overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <ActivityRowSkeleton key={i} />
            ))
          ) : recentActivity.length === 0 ? (
            <EmptyActivity />
          ) : (
            recentActivity.map((log) => {
              const color = ACTION_COLORS[log.action] ?? "bg-zinc-100 text-zinc-700";
              const icon = ACTION_ICONS[log.action] ?? "•";
              return (
                <div key={log.id} className="flex items-start gap-3 py-3">
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs",
                      color
                    )}
                  >
                    {icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-800 leading-snug">
                      {activityDescription(log)}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-zinc-400">{relativeTime(log.createdAt)}</span>
                      {log.actor && (
                        <span className="text-xs text-zinc-400">· {log.actor.name}</span>
                      )}
                      {log.candidate && (
                        <a
                          href={`/candidates/${log.candidate.id}`}
                          className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline"
                        >
                          View →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
