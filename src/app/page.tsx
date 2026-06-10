import { redirect } from "next/navigation";

/**
 * Root page — redirect to dashboard (or login if not authenticated,
 * handled by proxy.ts).
 */
export default function Home() {
  redirect("/dashboard");
}
