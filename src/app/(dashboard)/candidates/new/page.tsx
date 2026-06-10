"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { motion } from "framer-motion";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCandidateSchema, type CreateCandidateInput } from "@/validators/candidate";

export default function NewCandidatePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCandidateInput>({
    resolver: zodResolver(createCandidateSchema),
  });

  async function onSubmit(values: CreateCandidateInput) {
    setServerError(null);

    const res = await fetch("/api/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message =
        json?.error?.message ?? "Something went wrong. Please try again.";
      setServerError(message);
      return;
    }

    toast.success("Candidate added successfully.");
    await queryClient.invalidateQueries({ queryKey: ["candidates"] });
    router.push("/candidates");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Page header */}
      <div>
        <Link
          href="/candidates"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to candidates
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">Add candidate</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Fill in the details below to add a new candidate to your pipeline.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="rounded-xl border border-zinc-200 bg-white p-6"
      >
        {serverError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {serverError}
          </motion.div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-zinc-700">
              Full name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="Jane Smith"
              autoComplete="off"
              className={errors.name ? "border-red-400 focus-visible:ring-red-400" : ""}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-zinc-700">
              Phone number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+12125551234"
              autoComplete="off"
              className={errors.phone ? "border-red-400 focus-visible:ring-red-400" : ""}
              {...register("phone")}
            />
            {errors.phone ? (
              <p className="text-xs text-red-600">{errors.phone.message}</p>
            ) : (
              <p className="text-xs text-zinc-400">
                Use E.164 format, e.g. +12125551234
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role" className="text-zinc-700">
              Role / Position <span className="text-red-500">*</span>
            </Label>
            <Input
              id="role"
              type="text"
              placeholder="Software Engineer, Sales Rep…"
              autoComplete="off"
              className={errors.role ? "border-red-400 focus-visible:ring-red-400" : ""}
              {...register("role")}
            />
            {errors.role && (
              <p className="text-xs text-red-600">{errors.role.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-zinc-700">
              Notes{" "}
              <span className="font-normal text-zinc-400">(optional)</span>
            </Label>
            <Textarea
              id="notes"
              placeholder="Any relevant context about this candidate…"
              rows={3}
              className={`resize-none ${errors.notes ? "border-red-400 focus-visible:ring-red-400" : ""}`}
              {...register("notes")}
            />
            {errors.notes && (
              <p className="text-xs text-red-600">{errors.notes.message}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/candidates")}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-brand text-brand-fg hover:bg-brand-hover"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Add candidate"
              )}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
