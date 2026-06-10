import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { candidateRepository } from "@/repositories/candidate.repository";
import { auditLogRepository } from "@/repositories/audit-log.repository";
import { PageTransition } from "@/components/page-transition";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { formatPhone, relativeTime, absoluteTime, cn } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, Phone, Briefcase, Calendar, MessageCircle, Activity } from "lucide-react";
import { LaunchScreeningButton } from "./launch-screening-button";
import { DeleteCandidateButton } from "./delete-candidate-button";
import { RetryMessageButton } from "./retry-message-button";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CandidateDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return notFound();

  const candidate = await candidateRepository.findByIdWithDetails(
    id,
    session.user.id
  );

  if (!candidate) return notFound();

  const auditResult = await auditLogRepository.findByCandidateScope(id);

  const activeScreening = candidate.screenings.find(
    (s) => !["COMPLETED", "FAILED"].includes(s.state)
  );
  const latestScreening = candidate.screenings[0];
  const messages = candidate.conversation?.messages ?? [];
  const MESSAGE_ACTIONS = new Set(["MESSAGE_SENT", "MESSAGE_RECEIVED", "MESSAGE_DELIVERED", "MESSAGE_FAILED"]);
  const auditLogs = auditResult.data.filter((log) => !MESSAGE_ACTIONS.has(log.action));

  // Screening progress steps
  const STEPS = ["PENDING", "STARTED", "QUESTION_1", "QUESTION_2", "QUESTION_3", "QUESTION_4", "COMPLETED"];
  const currentStep = latestScreening
    ? STEPS.indexOf(latestScreening.state)
    : -1;

  return (
    <PageTransition className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/candidates">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{candidate.name}</h1>
          <p className="text-muted-foreground mt-1">{candidate.role}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={candidate.status} />
          {candidate.status === "PENDING" && (!activeScreening || activeScreening.state === "PENDING") && (
            <LaunchScreeningButton candidateId={id} />
          )}
          <DeleteCandidateButton candidateId={id} candidateName={candidate.name} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600 text-sm font-medium">
                {candidate.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium">{candidate.name}</p>
                <p className="text-xs text-muted-foreground">Candidate</p>
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs">{formatPhone(candidate.phone)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{candidate.role}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground text-xs">
                  Added {absoluteTime(candidate.createdAt, "MMM d, yyyy")}
                </span>
              </div>
            </div>
            {candidate.notes && (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground">{candidate.notes}</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Main content */}
        <div className="md:col-span-2 space-y-6">
          {/* Screening Progress */}
          {latestScreening && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Screening Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1">
                  {STEPS.filter(s => s !== "PENDING").map((step, idx) => {
                    const stepIdx = STEPS.indexOf(step);
                    const isCompleted = stepIdx < currentStep || latestScreening.state === "COMPLETED";
                    const isCurrent = STEPS[currentStep] === step;
                    const isFailed = latestScreening.state === "FAILED";

                    return (
                      <div key={step} className="flex items-center flex-1">
                        <div
                          className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 transition-colors",
                            isCompleted && !isFailed
                              ? "bg-neutral-900 text-white"
                              : isCurrent && !isFailed
                                ? "bg-blue-600 text-white ring-2 ring-blue-200"
                                : isFailed && (isCompleted || isCurrent)
                                  ? "bg-red-500 text-white"
                                  : "bg-neutral-100 text-neutral-400"
                          )}
                        >
                          {isCompleted && !isFailed ? "✓" : idx + 1}
                        </div>
                        {idx < STEPS.filter(s => s !== "PENDING").length - 1 && (
                          <div
                            className={cn(
                              "h-px flex-1 mx-1 transition-colors",
                              isCompleted ? "bg-neutral-900" : "bg-neutral-100"
                            )}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-between mt-2">
                  {["Intro", "Q1", "Q2", "Q3", "Q4", "Done"].map((label) => (
                    <span key={label} className="text-xs text-muted-foreground">{label}</span>
                  ))}
                </div>

                {/* Responses */}
                {latestScreening.responses.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {latestScreening.responses.map((response) => (
                      <div key={response.id} className="text-sm">
                        <p className="font-medium text-xs text-muted-foreground mb-0.5">
                          {response.question.prompt}
                        </p>
                        <p className="text-sm bg-neutral-50 rounded px-3 py-2 border border-neutral-100">
                          {response.rawText}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Conversation Timeline */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Messages</CardTitle>
              <span className="ml-auto text-xs text-muted-foreground">{messages.length} total</span>
            </CardHeader>
            <CardContent className="p-0">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8 px-4">
                  No messages yet. Launch a screening to begin.
                </p>
              ) : (
                <div className="flex flex-col gap-4 max-h-96 overflow-y-auto px-4 py-4">
                  {messages.map((message) => {
                    const isOutbound = message.direction === "OUTBOUND";
                    return (
                      <div
                        key={message.id}
                        className={cn("flex items-end gap-2.5", isOutbound ? "flex-row-reverse" : "flex-row")}
                      >
                        {/* Avatar */}
                        <div
                          className={cn(
                            "w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold",
                            isOutbound
                              ? "bg-brand text-brand-fg"
                              : "bg-zinc-200 text-zinc-600"
                          )}
                        >
                          {isOutbound ? "CF" : candidate.name.charAt(0).toUpperCase()}
                        </div>

                        {/* Bubble */}
                        <div className={cn("flex flex-col gap-1 max-w-[75%]", isOutbound ? "items-end" : "items-start")}>
                          <div
                            className={cn(
                              "px-3.5 py-2.5 text-sm leading-relaxed",
                              isOutbound
                                ? "bg-chat-out-bg text-chat-out-fg rounded-2xl rounded-tr-sm"
                                : "bg-chat-in-bg text-chat-in-fg border border-chat-in-border rounded-2xl rounded-tl-sm"
                            )}
                          >
                            {message.body}
                          </div>
                          <div className={cn("flex items-center gap-1.5 px-1", isOutbound ? "flex-row-reverse" : "flex-row")}>
                            <span className="text-[11px] text-muted-foreground">
                              {relativeTime(message.createdAt)}
                            </span>
                            <StatusBadge status={message.status} className="text-[10px]" />
                            {message.status === "FAILED" && isOutbound && (
                              <RetryMessageButton messageId={message.id} />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Audit Log */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No activity yet.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-300 mt-2 shrink-0" />
                      <div>
                        <span className="font-medium">
                          {log.action.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                        </span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {relativeTime(log.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTransition>
  );
}
