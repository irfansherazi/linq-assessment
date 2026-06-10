"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertTriangle,
  Eye,
  Loader2,
  RotateCcw,
  Play,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime, truncate, cn } from "@/lib/utils";
import type {
  WebhookEventStatus,
  RetryJobStatus,
  AuditAction,
} from "@/types";

type LogType = "audit" | "webhooks" | "retries";

interface Actor {
  name: string;
  email: string;
}

interface AuditRow {
  id: string;
  action: AuditAction;
  actorId: string | null;
  actor: Actor | null;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  candidate: { id: string; name: string } | null;
  createdAt: string;
}

interface WebhookPayloadData {
  id?: string;
  from?: string;
  chat?: { id?: string; participants?: string[] };
  parts?: { type: string; value: string }[];
  sent_at?: string;
  delivered_at?: string;
  failed_at?: string;
  reason?: string;
  code?: string | number;
}

interface WebhookRow {
  id: string;
  linqEventId: string;
  eventType: string;
  status: WebhookEventStatus;
  rawPayload: Record<string, unknown>;
  processedPayload: WebhookPayloadData | null;
  candidate: { id: string; name: string; phone: string } | null;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
}

interface RetryRow {
  id: string;
  status: RetryJobStatus;
  attempt: number;
  maxAttempts: number;
  nextRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  message: {
    id: string;
    body: string;
    status: string;
    conversation: {
      candidate: {
        id: string;
        name: string;
        phone: string;
      };
    };
  };
}

interface PaginatedResponse<T> {
  data: {
    data: T[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasMore: boolean;
    };
  };
}

// ── Shared components ────────────────────────────────────────────────────────

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-40" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyRows({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-14 text-center">
        <div className="flex flex-col items-center gap-2">
          <FileText className="h-7 w-7 text-zinc-300" />
          <p className="text-sm text-zinc-500">No records found</p>
        </div>
      </TableCell>
    </TableRow>
  );
}

function TabHeader({
  title,
  onRefresh,
  isFetching,
  actions,
}: {
  title: string;
  onRefresh: () => void;
  isFetching?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </p>
      <div className="flex items-center gap-1">
        {actions}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-7 text-xs text-zinc-500"
        >
          <RefreshCw className={cn("mr-1 h-3 w-3", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>
    </div>
  );
}

function ErrorBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-4 py-2">
      <p className="text-xs text-red-700">Failed to load data.</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="h-6 text-xs text-red-700"
      >
        Retry
      </Button>
    </div>
  );
}

function Pagination({
  page,
  pagination,
  onPage,
}: {
  page: number;
  pagination: { totalPages: number; hasMore: boolean; page: number };
  onPage: (p: number) => void;
}) {
  if (pagination.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3">
      <p className="text-xs text-zinc-500">
        Page {pagination.page} of {pagination.totalPages}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
          className="h-7 w-7 p-0"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(page + 1)}
          disabled={!pagination.hasMore}
          className="h-7 w-7 p-0"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Audit tab ────────────────────────────────────────────────────────────────

const ACTION_COLORS: Partial<Record<AuditAction, string>> = {
  CANDIDATE_CREATED: "bg-green-50 text-green-700",
  CANDIDATE_UPDATED: "bg-blue-50 text-blue-700",
  CANDIDATE_DELETED: "bg-red-50 text-red-700",
  SCREENING_STARTED: "bg-blue-50 text-blue-700",
  SCREENING_COMPLETED: "bg-green-50 text-green-700",
  SCREENING_FAILED: "bg-red-50 text-red-700",
  MESSAGE_SENT: "bg-zinc-100 text-zinc-600",
  MESSAGE_RECEIVED: "bg-purple-50 text-purple-700",
  MESSAGE_FAILED: "bg-red-50 text-red-700",
  MESSAGE_DELIVERED: "bg-green-50 text-green-700",
  RETRY_ENQUEUED: "bg-amber-50 text-amber-700",
  RETRY_SUCCEEDED: "bg-green-50 text-green-700",
  RETRY_DEAD_LETTERED: "bg-red-50 text-red-700",
};

function ActionBadge({ action }: { action: AuditAction }) {
  const cls = ACTION_COLORS[action] ?? "bg-zinc-100 text-zinc-600";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        cls
      )}
    >
      {action.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

// Strip internal DB ID keys — not useful to display raw CUIDs
const INTERNAL_META_KEYS = new Set(["candidateId", "screeningId", "messageId"]);

function MetadataCell({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return <span className="text-zinc-300">—</span>;
  const entries = Object.entries(metadata)
    .filter(([k]) => !INTERNAL_META_KEYS.has(k))
    .slice(0, 4);
  if (entries.length === 0) return <span className="text-zinc-300">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([k, v]) => (
        <span key={k} className="text-xs text-zinc-500">
          <span className="font-medium text-zinc-700">{k}:</span>{" "}
          {truncate(String(v), 40)}
        </span>
      ))}
    </div>
  );
}

function AuditTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, isError, refetch } =
    useQuery<PaginatedResponse<AuditRow>>({
      queryKey: ["logs", "audit", page],
      queryFn: () =>
        fetch(`/api/logs?type=audit&page=${page}&limit=50`).then((r) =>
          r.json()
        ),
      placeholderData: (prev) => prev,
    });

  const rows = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;

  return (
    <div>
      <TabHeader title="Audit Log" onRefresh={refetch} isFetching={isFetching} />
      {isError && <ErrorBanner onRetry={refetch} />}
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
      <Table>
        <TableHeader className="sticky top-0 bg-white z-10">
          <TableRow className="border-zinc-100">
            <TableHead className="text-xs font-medium text-zinc-500">Action</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Candidate</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Actor</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Details</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500 w-28">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton cols={5} />
          ) : rows.length === 0 ? (
            <EmptyRows cols={5} />
          ) : (
            rows.map((log) => (
              <TableRow
                key={log.id}
                className="border-zinc-50 hover:bg-zinc-50/50 align-top"
              >
                <TableCell className="py-3">
                  <ActionBadge action={log.action} />
                </TableCell>
                <TableCell className="py-3">
                  {log.candidate ? (
                    <Link
                      href={`/candidates/${log.candidate.id}`}
                      className="text-xs font-medium text-zinc-700 hover:underline"
                    >
                      {log.candidate.name}
                    </Link>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </TableCell>
                <TableCell className="py-3">
                  {log.actor ? (
                    <div>
                      <p className="text-xs font-medium text-zinc-700">
                        {log.actor.name}
                      </p>
                      <p className="text-[10px] text-zinc-400">{log.actor.email}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400">System</span>
                  )}
                </TableCell>
                <TableCell className="py-3 max-w-55">
                  <MetadataCell metadata={log.metadata} />
                </TableCell>
                <TableCell className="py-3 text-xs text-zinc-400 whitespace-nowrap">
                  {relativeTime(log.createdAt)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>
      {pagination && (
        <Pagination page={page} pagination={pagination} onPage={setPage} />
      )}
    </div>
  );
}

// ── Webhook detail dialog ────────────────────────────────────────────────────

function WebhookDetailDialog({
  evt,
  open,
  onClose,
}: {
  evt: WebhookRow | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!evt) return null;
  const p = evt.processedPayload;
  const bodyText = p?.parts?.find((pt) => pt.type === "text")?.value ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                EVENT_TYPE_COLORS[evt.eventType] ?? "bg-zinc-100 text-zinc-600"
              )}
            >
              {evt.eventType}
            </span>
            <span className="font-mono text-xs text-zinc-400">{evt.linqEventId}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2 overflow-y-auto flex-1 min-h-0 pr-1">
          {/* Candidate */}
          {evt.candidate && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
              <div className="w-6 h-6 rounded-full bg-zinc-200 flex items-center justify-center text-[10px] font-semibold text-zinc-600 shrink-0">
                {evt.candidate.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <Link href={`/candidates/${evt.candidate.id}`} className="text-sm font-medium text-zinc-900 hover:underline">
                  {evt.candidate.name}
                </Link>
                <p className="font-mono text-[10px] text-zinc-400">{evt.candidate.phone}</p>
              </div>
            </div>
          )}

          {/* Status + timestamps */}
          <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>
              <span className="font-medium text-zinc-700">Status:</span>{" "}
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-1.5 py-0.5 font-medium",
                  WEBHOOK_STATUS_COLORS[evt.status]
                )}
              >
                {evt.status.toLowerCase()}
              </span>
            </span>
            <span>
              <span className="font-medium text-zinc-700">Received:</span>{" "}
              {relativeTime(evt.createdAt)}
            </span>
            {evt.processedAt && (
              <span>
                <span className="font-medium text-zinc-700">Processed:</span>{" "}
                {relativeTime(evt.processedAt)}
              </span>
            )}
          </div>

          {/* Error */}
          {evt.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Error
              </p>
              <p className="text-xs text-red-600 font-mono break-all">{evt.errorMessage}</p>
            </div>
          )}

          {/* Message details */}
          {p && (
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-zinc-700">Message</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {p.from && (
                  <>
                    <span className="text-zinc-500">From</span>
                    <span className="font-mono text-zinc-700">{p.from}</span>
                  </>
                )}
                {p.id && (
                  <>
                    <span className="text-zinc-500">Message ID</span>
                    <span className="font-mono text-zinc-700 break-all">{p.id}</span>
                  </>
                )}
                {p.chat?.id && (
                  <>
                    <span className="text-zinc-500">Chat ID</span>
                    <span className="font-mono text-zinc-700 break-all">{p.chat.id}</span>
                  </>
                )}
                {p.chat?.participants && p.chat.participants.length > 0 && (
                  <>
                    <span className="text-zinc-500">Participants</span>
                    <span className="font-mono text-zinc-700">{p.chat.participants.join(", ")}</span>
                  </>
                )}
                {p.sent_at && (
                  <>
                    <span className="text-zinc-500">Sent at</span>
                    <span className="text-zinc-700">{new Date(p.sent_at).toLocaleString()}</span>
                  </>
                )}
                {p.delivered_at && (
                  <>
                    <span className="text-zinc-500">Delivered at</span>
                    <span className="text-zinc-700">{new Date(p.delivered_at).toLocaleString()}</span>
                  </>
                )}
                {p.failed_at && (
                  <>
                    <span className="text-zinc-500">Failed at</span>
                    <span className="text-zinc-700">{new Date(p.failed_at).toLocaleString()}</span>
                  </>
                )}
                {p.reason && (
                  <>
                    <span className="text-zinc-500">Failure reason</span>
                    <span className="text-red-600">{p.reason}{p.code != null ? ` (code: ${p.code})` : ""}</span>
                  </>
                )}
              </div>
              {bodyText && (
                <div className="mt-2 pt-2 border-t border-zinc-200">
                  <p className="text-xs font-semibold text-zinc-700 mb-1">Body</p>
                  <p className="text-sm text-zinc-800 whitespace-pre-wrap max-h-40 overflow-y-auto">{bodyText}</p>
                </div>
              )}
            </div>
          )}

          {/* Raw payload */}
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700 select-none">
              Raw payload
            </summary>
            <pre className="mt-2 rounded-lg bg-zinc-900 p-3 text-[11px] text-zinc-300 overflow-auto max-h-64 leading-relaxed">
              {JSON.stringify(evt.rawPayload, null, 2)}
            </pre>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Webhooks tab ─────────────────────────────────────────────────────────────

const WEBHOOK_STATUS_COLORS: Record<WebhookEventStatus, string> = {
  RECEIVED: "bg-zinc-100 text-zinc-600",
  PROCESSING: "bg-amber-50 text-amber-700",
  PROCESSED: "bg-green-50 text-green-700",
  FAILED: "bg-red-50 text-red-700",
  DUPLICATE: "bg-zinc-50 text-zinc-400",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  "message.sent": "bg-blue-50 text-blue-700",
  "message.received": "bg-purple-50 text-purple-700",
  "message.failed": "bg-red-50 text-red-700",
  "message.delivered": "bg-green-50 text-green-700",
  "message.read": "bg-green-50 text-green-600",
};

function WebhooksTab() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<WebhookRow | null>(null);

  const { data, isLoading, isFetching, isError, refetch } =
    useQuery<PaginatedResponse<WebhookRow>>({
      queryKey: ["logs", "webhooks", page],
      queryFn: () =>
        fetch(`/api/logs?type=webhooks&page=${page}&limit=50`).then((r) =>
          r.json()
        ),
      placeholderData: (prev) => prev,
    });

  const rows = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;

  return (
    <div>
      <TabHeader title="Webhook Events" onRefresh={refetch} isFetching={isFetching} />
      {isError && <ErrorBanner onRetry={refetch} />}
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
      <Table>
        <TableHeader className="sticky top-0 bg-white z-10">
          <TableRow className="border-zinc-100">
            <TableHead className="text-xs font-medium text-zinc-500">Event type</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Status</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Candidate</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Body / Error</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Event ID</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500 w-28">Received</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500 w-7"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton cols={7} />
          ) : rows.length === 0 ? (
            <EmptyRows cols={7} />
          ) : (
            rows.map((evt) => {
              const p = evt.processedPayload;
              const bodyText = p?.parts?.find((pt) => pt.type === "text")?.value ?? null;
              const hasError = !!evt.errorMessage;
              const failureReason = p?.reason
                ? `${p.reason}${p.code != null ? ` (${p.code})` : ""}`
                : null;
              return (
                <TableRow
                  key={evt.id}
                  className="border-zinc-50 hover:bg-zinc-50/50 align-middle"
                >
                  <TableCell className="py-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        EVENT_TYPE_COLORS[evt.eventType] ??
                          "bg-zinc-100 text-zinc-600"
                      )}
                    >
                      {evt.eventType}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        WEBHOOK_STATUS_COLORS[evt.status]
                      )}
                    >
                      {evt.status.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    {evt.candidate ? (
                      <div>
                        <Link
                          href={`/candidates/${evt.candidate.id}`}
                          className="text-xs font-medium text-zinc-700 hover:underline"
                        >
                          {evt.candidate.name}
                        </Link>
                        <p className="font-mono text-[10px] text-zinc-400">{evt.candidate.phone}</p>
                      </div>
                    ) : p?.from ? (
                      <span className="font-mono text-xs text-zinc-500">{p.from}</span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 max-w-60">
                    {hasError ? (
                      <span className="flex items-start gap-1 text-xs text-red-600">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {truncate(evt.errorMessage!, 55)}
                      </span>
                    ) : failureReason ? (
                      <span className="flex items-start gap-1 text-xs text-red-600">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {truncate(failureReason, 55)}
                      </span>
                    ) : bodyText ? (
                      <span className="text-xs text-zinc-600 italic">
                        &ldquo;{truncate(bodyText, 65)}&rdquo;
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 font-mono text-[10px] text-zinc-400">
                    {truncate(evt.linqEventId, 22)}
                  </TableCell>
                  <TableCell className="py-3 text-xs text-zinc-400 whitespace-nowrap">
                    {relativeTime(evt.createdAt)}
                  </TableCell>
                  <TableCell className="py-3">
                    <button
                      onClick={() => setSelected(evt)}
                      className="flex items-center justify-center w-6 h-6 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors cursor-pointer"
                      title="View details"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      </div>
      {pagination && (
        <Pagination page={page} pagination={pagination} onPage={setPage} />
      )}

      <WebhookDetailDialog
        evt={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ── Retries tab ──────────────────────────────────────────────────────────────

const RETRY_STATUS_COLORS: Record<RetryJobStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  SUCCEEDED: "bg-green-50 text-green-700",
  DEAD_LETTER: "bg-red-50 text-red-700",
};

/**
 * A job is "due" (and therefore stuck) when it's still PENDING/IN_PROGRESS but
 * its nextRunAt has already elapsed — i.e. the cron should have run it but
 * hasn't. These are the jobs that benefit from a manual "Run now".
 */
function isJobDue(job: RetryRow): boolean {
  if (job.status !== "PENDING" && job.status !== "IN_PROGRESS") return false;
  if (!job.nextRunAt) return false;
  return new Date(job.nextRunAt).getTime() <= Date.now();
}

/**
 * "Next run" only makes sense for jobs that will actually run again.
 * - SUCCEEDED / DEAD_LETTER are terminal: their nextRunAt is a stale leftover,
 *   so show nothing rather than a misleading "5 minutes ago".
 * - IN_PROGRESS: a worker is on it right now.
 * - PENDING and overdue: it's waiting for the next processor tick — show
 *   "due now" instead of a confusing "1 minute ago".
 * - PENDING in the future: show the relative time (e.g. "in 30 seconds").
 */
function NextRunDisplay({ job }: { job: RetryRow }) {
  if (job.status === "SUCCEEDED" || job.status === "DEAD_LETTER") {
    return <span className="text-zinc-300">—</span>;
  }
  if (job.status === "IN_PROGRESS") {
    return <span className="text-blue-600">running…</span>;
  }
  if (!job.nextRunAt) return <span className="text-zinc-300">—</span>;
  if (isJobDue(job)) {
    return <span className="font-medium text-amber-600">due now</span>;
  }
  return <span>{relativeTime(job.nextRunAt)}</span>;
}

function RetriesTab() {
  const [page, setPage] = useState(1);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const queryClient = useQueryClient();

  async function handleManualRetry(messageId: string) {
    setRetrying(messageId);
    try {
      const res = await fetch(`/api/messages/${messageId}/retry`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error("Failed to re-queue message");
      // The route processes the job inline, so the resend has already fired.
      // The message is now QUEUED with the provider (delivery confirmed async
      // via webhook), unless inline processing was skipped.
      if (json?.data?.processed) {
        toast.success("Retry sent — queued with provider for delivery");
      } else {
        toast.success("Message queued for retry");
      }
      await queryClient.invalidateQueries({ queryKey: ["logs", "retries"] });
    } catch {
      toast.error("Could not re-queue the message");
    } finally {
      setRetrying(null);
    }
  }

  // Manually trigger the retry processor (POST /api/cron/retry). This is the
  // dev/demo equivalent of the Vercel Cron tick, which only fires on deployed
  // instances. Drains all PENDING jobs whose nextRunAt has elapsed.
  async function handleRunRetries() {
    setProcessingAll(true);
    try {
      const res = await fetch("/api/cron/retry", { method: "POST" });
      if (res.status === 401) {
        toast.error(
          "Processor is protected by CRON_SECRET — it can only run via the scheduled cron."
        );
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to run retry processor");
      }
      const r = json.result as {
        processed: number;
        succeeded: number;
        failed: number;
        deadLettered: number;
      };
      if (r.processed === 0) {
        toast.success("No retry jobs were due to run");
      } else {
        toast.success(
          `Processed ${r.processed} job${r.processed === 1 ? "" : "s"}: ` +
            `${r.succeeded} sent, ${r.failed} rescheduled, ${r.deadLettered} dead-lettered`
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["logs", "retries"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run retry processor");
    } finally {
      setProcessingAll(false);
    }
  }

  const { data, isLoading, isFetching, isError, refetch } =
    useQuery<PaginatedResponse<RetryRow>>({
      queryKey: ["logs", "retries", page],
      queryFn: () =>
        fetch(`/api/logs?type=retries&page=${page}&limit=50`).then((r) =>
          r.json()
        ),
      placeholderData: (prev) => prev,
      // Jobs advance in the background (cron tick), so poll to keep the table
      // in sync rather than relying on a manual refresh.
      refetchInterval: 5_000,
    });

  const rows = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;

  return (
    <div>
      <TabHeader
        title="Retry Jobs"
        onRefresh={refetch}
        isFetching={isFetching}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunRetries}
            disabled={processingAll}
            className="h-7 text-xs"
          >
            {processingAll ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Run Retries Now
          </Button>
        }
      />
      {isError && <ErrorBanner onRetry={refetch} />}
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
      <Table>
        <TableHeader className="sticky top-0 bg-white z-10">
          <TableRow className="border-zinc-100">
            <TableHead className="text-xs font-medium text-zinc-500">Candidate</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Message</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Status</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500 w-20">Attempts</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Next run</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500">Error</TableHead>
            <TableHead className="text-xs font-medium text-zinc-500 w-28">Created</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton cols={8} />
          ) : rows.length === 0 ? (
            <EmptyRows cols={8} />
          ) : (
            rows.map((job) => (
              <TableRow
                key={job.id}
                className="border-zinc-50 hover:bg-zinc-50/50 align-top"
              >
                <TableCell className="py-3">
                  <Link
                    href={`/candidates/${job.message.conversation.candidate.id}`}
                    className="text-sm font-medium text-zinc-900 hover:underline"
                  >
                    {job.message.conversation.candidate.name}
                  </Link>
                  <p className="font-mono text-[10px] text-zinc-400 mt-0.5">
                    {job.message.conversation.candidate.phone}
                  </p>
                </TableCell>
                <TableCell className="py-3 max-w-45">
                  <p className="text-xs text-zinc-600 leading-snug">
                    {truncate(job.message.body, 80)}
                  </p>
                </TableCell>
                <TableCell className="py-3">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      RETRY_STATUS_COLORS[job.status]
                    )}
                  >
                    {job.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                </TableCell>
                <TableCell className="py-3 text-sm tabular-nums text-zinc-600">
                  {job.attempt} / {job.maxAttempts}
                </TableCell>
                <TableCell className="py-3 text-xs text-zinc-400 whitespace-nowrap">
                  <NextRunDisplay job={job} />
                </TableCell>
                <TableCell className="py-3 max-w-40">
                  {job.lastError ? (
                    <span className="flex items-start gap-1 text-xs text-red-600">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {truncate(job.lastError, 50)}
                    </span>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </TableCell>
                <TableCell className="py-3 text-xs text-zinc-400 whitespace-nowrap">
                  {relativeTime(job.createdAt)}
                </TableCell>
                <TableCell className="py-3">
                  {job.status === "DEAD_LETTER" || job.message.status === "FAILED" ? (
                    <button
                      onClick={() => handleManualRetry(job.message.id)}
                      disabled={retrying === job.message.id}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                    >
                      {retrying === job.message.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      Retry
                    </button>
                  ) : (
                    isJobDue(job) && (
                      // Stuck pending/in-progress job whose nextRunAt has elapsed
                      // but the cron never ran it. Trigger the processor inline.
                      <button
                        onClick={handleRunRetries}
                        disabled={processingAll}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                        title="This job is overdue — run the processor now"
                      >
                        {processingAll ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Run now
                      </button>
                    )
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>
      {pagination && (
        <Pagination page={page} pagination={pagination} onPage={setPage} />
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<LogType>("audit");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">System Logs</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Audit trail, webhook events, and retry job history.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="rounded-xl border border-zinc-200 bg-white overflow-hidden"
      >
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LogType)}>
          <div className="border-b border-zinc-100 px-4 pt-4">
            <TabsList className="h-9 bg-zinc-100">
              <TabsTrigger value="audit" className="text-xs">Audit</TabsTrigger>
              <TabsTrigger value="webhooks" className="text-xs">Webhooks</TabsTrigger>
              <TabsTrigger value="retries" className="text-xs">Retries</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="audit" className="m-0"><AuditTab /></TabsContent>
          <TabsContent value="webhooks" className="m-0"><WebhooksTab /></TabsContent>
          <TabsContent value="retries" className="m-0"><RetriesTab /></TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
