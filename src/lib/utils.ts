import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date as relative time ("2 hours ago") with a tooltip showing the exact date.
 */
export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "—";
  }
}

/**
 * Format a date as a human-readable absolute timestamp.
 */
export function absoluteTime(
  date: Date | string | null | undefined,
  fmt = "MMM d, yyyy 'at' h:mm a"
): string {
  if (!date) return "—";
  try {
    return format(new Date(date), fmt);
  } catch {
    return "—";
  }
}

/**
 * Format a phone number in E.164 to a readable format.
 * +12125551234 → (212) 555-1234
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return phone;
}

/**
 * Truncate a string to a maximum length, appending "…" if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

/**
 * Map a status enum value to a display label.
 */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "Pending",
    SCREENING: "Screening",
    COMPLETED: "Completed",
    FAILED: "Failed",
    WITHDRAWN: "Withdrawn",
    STARTED: "Started",
    QUESTION_1: "Q1",
    QUESTION_2: "Q2",
    QUESTION_3: "Q3",
    QUESTION_4: "Q4",
    SENT: "Sent",
    DELIVERED: "Delivered",
    RECEIVED: "Received",
    READ: "Read",
    QUEUED: "Queued for delivery",
    OUTBOUND: "Outbound",
    INBOUND: "Inbound",
    DEAD_LETTER: "Dead Letter",
    IN_PROGRESS: "In Progress",
    SUCCEEDED: "Succeeded",
    PROCESSED: "Processed",
    DUPLICATE: "Duplicate",
  };
  return labels[status] ?? status;
}
