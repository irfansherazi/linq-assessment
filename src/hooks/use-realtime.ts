"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RealtimeEvent } from "@/lib/kv";

/**
 * Opens an SSE connection to /api/events and reacts to real-time events
 * by invalidating TanStack Query caches and refreshing server components.
 *
 * Mount this once at the dashboard layout level.
 */
export function useRealtime() {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (e: MessageEvent<string>) => {
      let event: RealtimeEvent & { type: string };
      try {
        event = JSON.parse(e.data);
      } catch {
        return; // keepalive or non-JSON frame
      }

      switch (event.type) {
        case "message.received": {
          // Refresh server components (candidate detail page)
          router.refresh();
          // Invalidate client queries (candidates list, messages page)
          queryClient.invalidateQueries({ queryKey: ["candidates"] });
          queryClient.invalidateQueries({ queryKey: ["messages"] });
          if (event.candidateId) {
            queryClient.invalidateQueries({
              queryKey: ["candidate", event.candidateId],
            });
          }
          toast.info("New message received from candidate");
          break;
        }

        case "message.sent":
        case "message.failed": {
          router.refresh();
          queryClient.invalidateQueries({ queryKey: ["messages"] });
          if (event.candidateId) {
            queryClient.invalidateQueries({
              queryKey: ["candidate", event.candidateId],
            });
          }
          if (event.type === "message.failed") {
            toast.error("Message delivery failed");
          }
          break;
        }

        case "screening.updated":
        case "candidate.updated": {
          router.refresh();
          queryClient.invalidateQueries({ queryKey: ["candidates"] });
          if (event.candidateId) {
            queryClient.invalidateQueries({
              queryKey: ["candidate", event.candidateId],
            });
          }
          break;
        }
      }
    };

    es.onerror = () => {
      // EventSource reconnects automatically — no action needed
    };

    return () => es.close();
  }, [router, queryClient]);
}
