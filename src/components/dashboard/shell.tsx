"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import type { Session } from "next-auth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  FileText,
  Settings,
  LogOut,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/logs", label: "Logs", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active ? "text-zinc-900" : "text-zinc-400 group-hover:text-zinc-900"
        )}
      />
      {label}
    </Link>
  );
}

function Sidebar({
  pathname,
  onNavClick,
}: {
  pathname: string;
  onNavClick?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {NAV_ITEMS.map((item) => (
        <NavItem
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          active={
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href)
          }
          onClick={onNavClick}
        />
      ))}
    </nav>
  );
}

function UserMenu({ session }: { session: Session }) {
  const router = useRouter();
  const name = session.user?.name ?? "User";
  const email = session.user?.email ?? "";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSignOut() {
    await signOut({ redirect: false });
    router.push("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 focus:outline-none">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-brand text-xs text-brand-fg">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[120px] truncate font-medium text-zinc-900 sm:block">
            {name}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium text-zinc-900 truncate">{name}</p>
          <p className="text-xs text-zinc-500 truncate">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="cursor-pointer text-red-600 focus:bg-red-50 focus:text-red-700"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-zinc-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-zinc-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2.5 border-b border-zinc-100 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand">
            <MessageSquare className="h-3.5 w-3.5 text-brand-fg" />
          </div>
          <span className="text-sm font-semibold text-zinc-900">
            CandidateFlow
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Sidebar pathname={pathname} />
        </div>
        <div className="border-t border-zinc-100 p-3">
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            {session.user?.role ?? "RECRUITER"}
          </p>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/30 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed inset-y-0 left-0 z-50 w-56 border-r border-zinc-200 bg-white lg:hidden"
            >
              <div className="flex h-14 items-center justify-between border-b border-zinc-100 px-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand">
                    <MessageSquare className="h-3.5 w-3.5 text-brand-fg" />
                  </div>
                  <span className="text-sm font-semibold text-zinc-900">
                    CandidateFlow
                  </span>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="rounded p-1 hover:bg-zinc-100"
                >
                  <X className="h-4 w-4 text-zinc-500" />
                </button>
              </div>
              <Sidebar
                pathname={pathname}
                onNavClick={() => setMobileOpen(false)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 sm:px-6">
          <button
            className="rounded p-1.5 hover:bg-zinc-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5 text-zinc-500" />
          </button>
          <div className="flex-1 lg:hidden" />
          <div className="ml-auto">
            <UserMenu session={session} />
          </div>
        </header>

        {/* Page content with motion */}
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
