import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "CandidateFlow — Authentication",
  description: "Recruiting SMS platform",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 px-4">
      {/* Branding */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-5 w-5 text-brand-fg"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z"
            />
          </svg>
        </div>
        <span className="text-xl font-semibold tracking-tight text-zinc-900">
          CandidateFlow
        </span>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        {children}
      </div>

      <p className="mt-6 text-xs text-zinc-400">
        &copy; {new Date().getFullYear()} CandidateFlow. All rights reserved.
      </p>
    </div>
  );
}
