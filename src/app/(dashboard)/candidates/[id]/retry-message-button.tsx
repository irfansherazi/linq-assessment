"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface RetryMessageButtonProps {
  messageId: string;
}

export function RetryMessageButton({ messageId }: RetryMessageButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    try {
      const res = await fetch(`/api/messages/${messageId}/retry`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to queue retry");
      // The route processes the job inline, so the resend has already fired and
      // the message is queued with the provider (delivery confirmed via webhook).
      toast.success(
        json.data?.processed
          ? "Retry sent — queued with provider for delivery"
          : "Message queued for retry"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue retry");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleRetry}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer"
      title="Retry this message"
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RotateCcw className="h-3 w-3" />
      )}
      Retry
    </button>
  );
}
