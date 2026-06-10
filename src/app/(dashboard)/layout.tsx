import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard/shell";
import { RealtimeProvider } from "@/components/realtime-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <DashboardShell session={session}>
      <RealtimeProvider>
        {children}
      </RealtimeProvider>
    </DashboardShell>
  );
}
