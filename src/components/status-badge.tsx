import { Badge } from "@/components/ui/badge";
import { cn, statusLabel } from "@/lib/utils";

type StatusVariant =
  | "PENDING"
  | "SCREENING"
  | "COMPLETED"
  | "FAILED"
  | "WITHDRAWN"
  | "STARTED"
  | "QUESTION_1"
  | "QUESTION_2"
  | "QUESTION_3"
  | "QUESTION_4"
  | "SENT"
  | "DELIVERED"
  | "RECEIVED"
  | "READ"
  | "QUEUED"
  | "DEAD_LETTER"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "PROCESSED"
  | "DUPLICATE"
  | string;

const statusStyles: Record<string, string> = {
  PENDING:     "bg-neutral-100 text-neutral-600 border-neutral-200",
  SCREENING:   "bg-blue-50 text-blue-700 border-blue-200",
  STARTED:     "bg-blue-50 text-blue-700 border-blue-200",
  QUESTION_1:  "bg-violet-50 text-violet-700 border-violet-200",
  QUESTION_2:  "bg-violet-50 text-violet-700 border-violet-200",
  QUESTION_3:  "bg-violet-50 text-violet-700 border-violet-200",
  QUESTION_4:  "bg-violet-50 text-violet-700 border-violet-200",
  COMPLETED:   "bg-green-50 text-green-700 border-green-200",
  SUCCEEDED:   "bg-green-50 text-green-700 border-green-200",
  PROCESSED:   "bg-green-50 text-green-700 border-green-200",
  FAILED:      "bg-red-50 text-red-700 border-red-200",
  DEAD_LETTER: "bg-red-50 text-red-700 border-red-200",
  WITHDRAWN:   "bg-neutral-100 text-neutral-500 border-neutral-200",
  SENT:        "bg-sky-50 text-sky-700 border-sky-200",
  DELIVERED:   "bg-green-50 text-green-700 border-green-200",
  RECEIVED:    "bg-amber-50 text-amber-700 border-amber-200",
  READ:        "bg-teal-50 text-teal-700 border-teal-200",
  QUEUED:      "bg-orange-50 text-orange-700 border-orange-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  DUPLICATE:   "bg-neutral-100 text-neutral-500 border-neutral-200",
};

interface StatusBadgeProps {
  status: StatusVariant;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = statusStyles[status] ?? "bg-neutral-100 text-neutral-600 border-neutral-200";

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-medium px-2 py-0.5 rounded-full border",
        style,
        className
      )}
    >
      {statusLabel(status)}
    </Badge>
  );
}
