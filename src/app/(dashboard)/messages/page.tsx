"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPhone, relativeTime, truncate, cn } from "@/lib/utils";
import type { MessageStatus, MessageDirection } from "@/types";
import { useDebounce } from "@/hooks/use-debounce";
import { StatusBadge } from "@/components/status-badge";

interface MessageRow {
  id: string;
  body: string;
  direction: MessageDirection;
  status: MessageStatus;
  createdAt: string;
  sentAt: string | null;
  linqMessageId: string | null;
  errorReason: string | null;
  conversation: {
    candidate: {
      id: string;
      name: string;
      phone: string;
    };
  };
}

interface MessagesResponse {
  data: {
    data: MessageRow[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasMore: boolean;
    };
  };
}

const STATUS_OPTIONS: Array<{ value: MessageStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "QUEUED", label: "Queued" },
  { value: "SENT", label: "Sent" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "RECEIVED", label: "Received" },
  { value: "READ", label: "Read" },
  { value: "FAILED", label: "Failed" },
];

const FROM_PHONE = process.env.NEXT_PUBLIC_LINQ_FROM_PHONE ?? "+13109250241";

function DirectionCell({ direction, candidatePhone }: { direction: MessageDirection; candidatePhone: string }) {
  const isOutbound = direction === "OUTBOUND";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isOutbound ? "text-blue-600" : "text-purple-600"
      )}>
        {isOutbound
          ? <ArrowUpRight className="h-3 w-3" />
          : <ArrowDownLeft className="h-3 w-3" />
        }
        {isOutbound ? "Outbound" : "Inbound"}
      </span>
      <span className="font-mono text-[10px] text-zinc-400">
        {isOutbound
          ? `${formatPhone(FROM_PHONE)} → ${formatPhone(candidatePhone)}`
          : `${formatPhone(candidatePhone)} → ${formatPhone(FROM_PHONE)}`
        }
      </span>
    </div>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell><Skeleton className="h-8 w-36" /></TableCell>
          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
          <TableCell><Skeleton className="h-4 w-64" /></TableCell>
          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function MessagesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MessageStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const params = new URLSearchParams({
    page: String(page),
    limit: "50",
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status !== "ALL" ? { status } : {}),
  });

  const { data, isLoading, isFetching, isError, refetch } = useQuery<MessagesResponse>({
    queryKey: ["messages", debouncedSearch, status, page],
    queryFn: () => fetch(`/api/messages?${params}`).then((r) => r.json()),
    placeholderData: (prev) => prev,
  });

  const messages = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Messages</h1>
        {pagination && (
          <p className="mt-0.5 text-sm text-zinc-500">
            {pagination.total} total messages
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search by message content or candidate name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => { setStatus(v as MessageStatus | "ALL"); setPage(1); }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">Failed to load messages.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-red-200 text-red-700 hover:bg-red-100">
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Retry
          </Button>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="rounded-xl border border-zinc-200 bg-white"
      >
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-100">
              <TableHead className="text-xs font-medium text-zinc-500">Direction / Phones</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Candidate</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Message</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500 w-28">Status</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500 w-28">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton />
            ) : messages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Search className="h-8 w-8 text-zinc-300" />
                    <p className="text-sm font-medium text-zinc-500">No messages found</p>
                    <p className="text-xs text-zinc-400">Messages appear here once candidates are screened.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              messages.map((msg) => (
                <TableRow key={msg.id} className="border-zinc-50 hover:bg-zinc-50/50 align-top">
                  <TableCell className="py-3">
                    <DirectionCell
                      direction={msg.direction}
                      candidatePhone={msg.conversation.candidate.phone}
                    />
                  </TableCell>
                  <TableCell className="py-3">
                    <Link
                      href={`/candidates/${msg.conversation.candidate.id}`}
                      className="text-sm font-medium text-zinc-900 hover:underline"
                    >
                      {msg.conversation.candidate.name}
                    </Link>
                    <p className="font-mono text-[10px] text-zinc-400 mt-0.5">
                      {formatPhone(msg.conversation.candidate.phone)}
                    </p>
                  </TableCell>
                  <TableCell className="py-3 max-w-xs">
                    <p className="text-sm text-zinc-700 leading-snug">
                      {truncate(msg.body, 120)}
                    </p>
                    {msg.errorReason && (
                      <p className="mt-1 text-xs text-red-500">{msg.errorReason}</p>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <StatusBadge status={msg.status} />
                  </TableCell>
                  <TableCell className="py-3 text-xs text-zinc-400 whitespace-nowrap">
                    {relativeTime(msg.sentAt ?? msg.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3">
            <p className="text-xs text-zinc-500">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="h-7 w-7 p-0">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!pagination.hasMore} className="h-7 w-7 p-0">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
