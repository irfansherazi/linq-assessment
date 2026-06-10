"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Plus,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
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
import { formatPhone, relativeTime, cn } from "@/lib/utils";
import type { CandidateStatus } from "@/types";
import type { CandidateWithLatestScreening } from "@/repositories/candidate.repository";
import { useDebounce } from "@/hooks/use-debounce";
import { StatusBadge } from "@/components/status-badge";

interface CandidateResponse {
  data: {
    data: CandidateWithLatestScreening[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasMore: boolean;
    };
  };
}

const STATUS_OPTIONS: Array<{ value: CandidateStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "SCREENING", label: "Screening" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-32" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-7 w-16 rounded-lg" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function EmptyCandidates({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={6} className="py-16 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100">
            <Search className="h-5 w-5 text-zinc-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-700">
              {hasFilters ? "No candidates match your filters" : "No candidates yet"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {hasFilters
                ? "Try adjusting your search or status filter."
                : "Add a candidate to get started."}
            </p>
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={onClear} className="text-xs">
              Clear filters
            </Button>
          ) : (
            <Button asChild size="sm" className="bg-brand text-brand-fg hover:bg-brand-hover">
              <Link href="/candidates/new">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add candidate
              </Link>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function CandidatesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CandidateStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const params = new URLSearchParams({
    page: String(page),
    limit: "20",
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status !== "ALL" ? { status } : {}),
  });

  const { data, isLoading, isFetching, isError, refetch } = useQuery<CandidateResponse>({
    queryKey: ["candidates", debouncedSearch, status, page],
    queryFn: () => fetch(`/api/candidates?${params}`).then((r) => r.json()),
    placeholderData: (prev) => prev,
  });

  const candidates = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;
  const hasFilters = !!debouncedSearch || status !== "ALL";

  function clearFilters() {
    setSearch("");
    setStatus("ALL");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Candidates</h1>
          {pagination && (
            <p className="mt-0.5 text-sm text-zinc-500">
              {pagination.total} total
            </p>
          )}
        </div>
        <Button asChild className="bg-brand text-brand-fg hover:bg-brand-hover">
          <Link href="/candidates/new">
            <Plus className="mr-1.5 h-4 w-4" />
            Add candidate
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search by name, phone, or role…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as CandidateStatus | "ALL");
            setPage(1);
          }}
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

      {/* Error state */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">Failed to load candidates.</p>
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

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="rounded-xl border border-zinc-200 bg-white"
      >
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-100">
              <TableHead className="text-xs font-medium text-zinc-500">Name</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Phone</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Role</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Status</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Last activity</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton />
            ) : candidates.length === 0 ? (
              <EmptyCandidates hasFilters={hasFilters} onClear={clearFilters} />
            ) : (
              candidates.map((candidate) => (
                <TableRow
                  key={candidate.id}
                  className="border-zinc-50 hover:bg-zinc-50/50"
                >
                  <TableCell className="font-medium text-zinc-900">
                    {candidate.name}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-zinc-600">
                    {formatPhone(candidate.phone)}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-600">
                    {candidate.role}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={candidate.status} />
                  </TableCell>
                  <TableCell className="text-sm text-zinc-400">
                    {relativeTime(candidate.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-zinc-600 hover:text-zinc-900"
                    >
                      <Link href={`/candidates/${candidate.id}`}>
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3">
            <p className="text-xs text-zinc-500">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!pagination.hasMore}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
