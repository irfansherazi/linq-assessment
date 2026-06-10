"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";

interface LaunchScreeningButtonProps {
  candidateId: string;
}

export function LaunchScreeningButton({ candidateId }: LaunchScreeningButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLaunch() {
    setLoading(true);
    try {
      const res = await fetch("/api/screenings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error?.message ?? "Failed to launch screening");
      }

      toast.success("Screening launched! Intro SMS sent.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to launch screening");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      onClick={handleLaunch}
      disabled={loading}
    >
      {loading ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          Launching…
        </>
      ) : (
        <>
          <Play className="h-3.5 w-3.5 mr-1.5" />
          Launch Screening
        </>
      )}
    </Button>
  );
}
