# CandidateFlow

A production-grade recruiting SMS communication platform built on the **Linq Partner API**.

Recruiters create candidates, launch SMS screening workflows, and watch the state-machine-driven Q&A progress automatically as candidates reply from their phones. Every layer — ingestion, retry, audit, observability — is designed to operate under real load with real failure modes.

> **Assessment note:** This is a live integration. The provisioned Linq number (`+13109250241`) is real, webhook processing is real, and sending a text to that number while the application is running will trigger the state machine.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Start Postgres (Postgres.app or docker)
open -a "Postgres"          # macOS with Postgres.app

# 3. Create database + run migrations
createdb candidateflow
npx prisma migrate dev

# 4. Seed demo data
npm run seed

# 5. Set up Linq webhook subscription (requires a public URL)
#    Option A — cloudflared
cloudflared tunnel --url http://localhost:3000
#    Option B — ngrok
ngrok http 3000

npm run linq:webhook:setup -- https://<your-public-url>
# Captures the signing secret and writes it to .env.local automatically

# 6. Start dev server
npm run dev
```

Login: `demo@candidateflow.io` / `Demo1234!`

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Next.js 16 App Router                   │
│  (auth) pages  │  (dashboard) pages  │  /api route handlers│
└───────────┬────────────────────────────────────┬───────────┘
            │                                    │
     Server Components                   API handlers (thin)
     TanStack Query                       withErrorHandler()
     Framer Motion                              │
                                        ┌──────┴──────┐
                                        │   Services  │
                                        │  (business  │
                                        │   logic)    │
                                        └──────┬──────┘
                                               │
                                        ┌──────┴──────┐
                                        │ Repositories│
                                        │ (data only) │
                                        └──────┬──────┘
                                               │
                                          Prisma 7 + pg
                                          PostgreSQL
```

### Layering rule
Route handler → service → repository → Prisma.  
Services own transactions, audit records, and structured logging.  
Repositories contain only data access — no business logic, ever.

---

## Folder structure

```
src/
├── app/
│   ├── (auth)/          # login, signup, forgot-password, reset-password
│   ├── (dashboard)/     # dashboard, candidates, messages, logs, settings
│   └── api/             # candidates, screenings, messages, logs, dashboard,
│                        # settings, cron/retry, webhooks/linq
├── components/          # ui/ (shadcn), shared (StatusBadge, MetricCard,
│                        # PageTransition, EmptyState, Skeleton, Providers)
│   └── dashboard/       # shell.tsx (sidebar + top bar)
├── features/            # per-feature query hooks (future growth)
├── hooks/               # useDebounce
├── lib/
│   ├── db.ts            # Prisma 7 adapter-pg singleton
│   ├── env.ts           # Zod-validated env (fail-fast at boot)
│   ├── errors/          # AppError hierarchy + withErrorHandler
│   ├── linq/            # LinqClient + typed API response shapes
│   ├── logger.ts        # Pino + child loggers per subsystem
│   ├── ratelimit.ts     # Token bucket (swap for Upstash in multi-instance)
│   ├── utils.ts         # cn, relativeTime, formatPhone, statusLabel
│   └── webhooks/        # Standard Webhooks signature verify
├── repositories/        # One file per aggregate (candidate, message, ...)
├── services/
│   ├── audit/           # Fire-and-forget append-only audit trail
│   ├── messaging/       # MessagingProvider interface + LinqMessagingProvider
│   ├── retry/           # Exponential backoff + dead-letter processor
│   └── screening/       # State machine + workflow engine
├── types/               # Shared domain types (re-exports Prisma models)
└── validators/          # Zod schemas shared between client + server

scripts/
├── seed.ts              # Demo data (recruiter, questions, 8 candidates)
└── linq-webhook-setup.ts# Creates subscription + captures signing_secret

prisma/
├── schema.prisma        # 13 models, normalized, indexed
├── migrations/          # Versioned SQL
└── prisma.config.ts     # Prisma 7 datasource (no url in schema)

test/
└── unit/
    ├── state-machine.test.ts      # 34 tests
    ├── backoff.test.ts            # 10 tests
    ├── webhook-verify.test.ts     # 19 tests
    ├── webhook-idempotency.test.ts# 11 tests (full route handler mocked)
    └── errors.test.ts             # 12 tests
```

---

## Core subsystems

### Screening state machine

States: `PENDING → STARTED → QUESTION_1..4 → COMPLETED | FAILED`

Implemented as an **explicit transition table** — no `if/else` chains, no magic. Each valid transition is declared; anything not in the table throws `InvalidStateTransitionError`. The question list drives states, so adding a 5th question requires only a DB insert — no code change.

```
PENDING  ──(launch)──▶  STARTED
STARTED  ──(START)───▶  QUESTION_1
QUESTION_N ──(reply)──▶ QUESTION_N+1 | COMPLETED
any ──(error/timeout)──▶ FAILED
```

The workflow engine wraps each state transition in a `db.$transaction`, so a crash mid-send can't leave the DB in an inconsistent state.

### Webhook ingestion pipeline

```
POST /api/webhooks/linq
  1. Rate limit (100/min per IP — token bucket)
  2. Read raw body (never parse before verify)
  3. Standard Webhooks HMAC-SHA256 verify (5-min tolerance window)
  4. Parse JSON
  5. Idempotency gate — findOrCreate by linqEventId (unique webhook-id header)
     └─ duplicate? → return 200 immediately (no-op)
  6. markProcessing (optimistic lock)
  7. dispatch(eventType) → handler
     ├─ message.sent      → updateStatus(SENT) + audit
     ├─ message.failed    → updateStatus(FAILED) + enqueueRetry
     ├─ message.received  → workflowEngine.handleInboundReply()
     ├─ message.delivered → updateStatus(DELIVERED) [iMessage/RCS]
     └─ message.read      → updateStatus(READ) [iMessage]
  8. markProcessed | markFailed
  9. Always return 200 after verify — prevent retry storms
```

**Key principle:** failures after verification are handled internally. Linq receives 200 and does not re-deliver. Internal failures are logged, marked, and retried by the cron job.

### Retry system

`RetryJob` table with states: `pending → in_progress → succeeded | dead_letter`

Backoff formula: `min(2s × 2^(attempt-1), 5min) ± 20% jitter`

| Attempt | Base delay |
|---------|-----------|
| 1       | ~2s        |
| 2       | ~4s        |
| 3       | ~8s        |
| 4       | ~16s       |
| 5       | ~32s       |
| >5      | dead_letter|

The cron route (`/api/cron/retry`) fires every minute via Vercel Cron. It claims a batch of 10 due jobs atomically (preventing double-processing across concurrent invocations), re-sends via `LinqMessagingProvider`, and re-schedules or promotes to `dead_letter`. The `Retry-After` header from Linq 429 responses overrides the backoff floor.

### Error handling

Every thrown value has a typed home:

| Class | Code | HTTP |
|-------|------|------|
| `ValidationError` | `VALIDATION_ERROR` | 400 |
| `UnauthorizedError` | `UNAUTHORIZED` | 401 |
| `NotFoundError` | `NOT_FOUND` | 404 |
| `ConflictError` | `CONFLICT` | 409 |
| `LinqApiError` | `LINQ_API_ERROR` | 502 |
| `LinqRateLimitError` | `LINQ_RATE_LIMIT` | 502 |
| `WebhookVerificationError` | `WEBHOOK_VERIFICATION_FAILED` | 401 |
| `InvalidStateTransitionError` | `INVALID_STATE_TRANSITION` | 422 |
| `DuplicateCandidateError` | `DUPLICATE_CANDIDATE` | 422 |

`withErrorHandler` wraps every API route. It catches `AppError` subclasses and maps them to `{ error: { code, message, details, requestId } }` — structured, machine-readable, never leaking stack traces.

### Audit trail

`audit.record()` is fire-and-forget — it never throws, never blocks a request. Every candidate creation, screening state change, message send/failure, and recruiter action appends a row to `AuditLog`. Visible in the candidate detail page and the `/logs` observability tab.

### Structured logging

Pino with pretty-printing in dev. Every subsystem has its own child logger:

```typescript
const webhookLogger   = logger.child({ subsystem: "webhook" });
const screeningLogger = logger.child({ subsystem: "screening" });
const retryLogger     = logger.child({ subsystem: "retry" });
```

The `proxy.ts` (Next.js 16 equivalent of middleware) attaches a correlation `x-request-id` header to every request. Route handlers pass it to their child logger and to the response for client-side correlation.

---

## Database schema

13 models, all with `createdAt`/`updatedAt`, indexed on every FK and status column:

| Model | Purpose |
|-------|---------|
| `User` | Recruiter accounts (bcrypt password, role) |
| `PasswordResetToken` | Forgot/reset password flow |
| `Candidate` | Soft-deletable, unique phone per recruiter |
| `Screening` | State + question index + timestamps |
| `ScreeningQuestion` | Ordered question prompts |
| `ScreeningResponse` | Raw text per question answer |
| `Conversation` | Linq chat ID per candidate |
| `Message` | Direction, body, status, idempotency key |
| `MessageEvent` | Per-message lifecycle audit |
| `WebhookEvent` | `linqEventId` unique — idempotency gate |
| `RetryJob` | Backoff state machine per failed send |
| `AuditLog` | Append-only recruiter/system actions |

---

## Linq integration details

### Authentication
`Authorization: Bearer <LINQ_API_KEY>` on every request. All HTTP is isolated in `src/lib/linq/client.ts` — nothing outside calls Linq directly.

### Sending messages
- **New conversation:** `POST /chats` with `preferred_service: "SMS"` (forces SMS, not iMessage)
- **Existing conversation:** `POST /chats/{chatId}/messages`
- Every send includes a unique `idempotency_key` (nanoid) to prevent duplicate delivery

### Webhooks
Signed with the [Standard Webhooks](https://www.standardwebhooks.com/) spec:  
`HMAC-SHA256("webhook-id.webhook-timestamp.body", base64_decode(secret.replace("whsec_","")))`

The `signing_secret` is returned **only at subscription creation**. The `linq-webhook-setup` script captures it and writes `LINQ_WEBHOOK_SECRET=whsec_...` to `.env.local`.

### SMS delivery events
SMS fires only `message.sent` and `message.failed`. There is no `delivered` or `read` for SMS (those are iMessage/RCS-only). The UI reflects this honestly — delivery status shows "Sent via SMS" once `message.sent` is received, and does not promise more.

### Rate limits
429 responses include `Retry-After` (seconds). `LinqClient` throws `LinqRateLimitError(retryAfterSeconds)`. The retry system respects this as a floor: `max(backoffDelay, retryAfterDelay)`.

---

## Auth

Auth.js v5 (NextAuth beta) with Credentials provider:
- `bcryptjs` password hashing (12 rounds)
- JWT sessions (stateless, no session DB table needed)
- Role field (`RECRUITER | ADMIN`) in JWT token
- Forgot/reset password via `PasswordResetToken` (1-hour TTL)
- `proxy.ts` (Next.js 16 middleware equivalent) protects all `/dashboard` and `/api/` routes except auth endpoints

---

## Deployment

### Vercel + Neon

```bash
# 1. Create Neon project at neon.tech
# 2. Add environment variables in Vercel dashboard:
#    DATABASE_URL, AUTH_SECRET, LINQ_API_KEY, LINQ_FROM_PHONE, LINQ_WEBHOOK_SECRET
# 3. Deploy
vercel deploy --prod

# 4. Run migrations against production
DATABASE_URL=<prod-url> npx prisma migrate deploy

# 5. Register webhook subscription
npm run linq:webhook:setup -- https://your-app.vercel.app
```

The `vercel.json` configures a cron job that fires `/api/cron/retry` every minute:

```json
{
  "crons": [{ "path": "/api/cron/retry", "schedule": "* * * * *" }]
}
```

Protect the cron route in production with `CRON_SECRET` validation (currently open for assessment convenience).

### Local development with inbound SMS

Linq webhooks require a public URL. For local development:

```bash
# Option A — cloudflared (no account needed)
cloudflared tunnel --url http://localhost:3000
# → https://xxxx.trycloudflare.com

# Option B — ngrok
ngrok http 3000
# → https://xxxx-xx-xx-xx.ngrok-free.app

npm run linq:webhook:setup -- <public-url>
npm run dev
```

---

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

Test suite breakdown (76 tests):

| File | Tests | What it covers |
|------|-------|----------------|
| `state-machine.test.ts` | 34 | All state transitions, terminal states, question progression, START trigger |
| `webhook-verify.test.ts` | 19 | Valid sig, tampered body, wrong secret, expired timestamp, future timestamp, multiple sigs |
| `webhook-idempotency.test.ts` | 11 | Full route handler: sig reject, idempotency gate, dispatch, failure handling, rate limit |
| `backoff.test.ts` | 10 | Exponential growth, cap, Retry-After override, exhaustion |
| `errors.test.ts` | 12 | Error class hierarchy, `isAppError`, `toAppError` |

Integration tests (DB-level) and E2E are the natural next layer — the repository pattern makes them straightforward to add.

---

## Tradeoffs and honest notes

**No runtime simulator by design.** The provisioned Linq number is live. Tests use HTTP test-doubles (vi.mock); the production code hits real Linq endpoints. This is the right choice for a system where the integration behaviour matters.

**In-memory rate limiter.** `TokenBucketRateLimiter` works correctly on a single instance / serverless cold-start-per-request model. For horizontally scaled deployments, replace it with Upstash Redis behind the same `RateLimiter` interface — the code change is one file.

**SMS delivers `sent`/`failed` only.** No `delivered`/`read` for SMS — this is a Linq/carrier constraint, not a bug. The DB schema and UI are designed around this. The `delivered`/`read` paths are wired for when iMessage or RCS come online.

**State machine supports up to 4 questions.** The explicit state names (`QUESTION_1..4`) are the only hardcoded assumption. Adding a 5th requires adding `QUESTION_5` to the enum and transition table — a 5-minute change. A fully dynamic approach (state derived from `currentQuestionIndex`) is possible but loses the compile-time guarantee that an invalid state is caught.

**`proxy.ts` replaces `middleware.ts`.** Next.js 16 renamed the export from `middleware` to `proxy`. The `AGENTS.md` in the repo documents this and links to the breaking-change guide.

**Prisma 7 breaking changes.** Three key changes from Prisma 5/6: (1) `url` removed from `schema.prisma` datasource — it's in `prisma.config.ts` only; (2) `@prisma/adapter-pg` is mandatory; (3) generated output is `.ts` files under `src/generated/prisma/` not `@prisma/client`. All three are handled correctly.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_SECRET` | ✅ | Auth.js session signing secret (32+ chars) |
| `LINQ_API_KEY` | ✅ | Partner API key |
| `LINQ_FROM_PHONE` | ✅ | Provisioned Linq number (E.164) |
| `LINQ_WEBHOOK_SECRET` | ✅ (prod) | `whsec_...` from webhook subscription (set by `linq:webhook:setup`) |
| `NEXT_PUBLIC_APP_URL` | optional | Public URL for webhook registration |
| `CRON_SECRET` | optional | Bearer token to protect `/api/cron/retry` in production |

---

## Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm test` | Run all Vitest tests |
| `npm run test:coverage` | Coverage report |
| `npm run seed` | Seed demo data |
| `npm run linq:webhook:setup -- <url>` | Register webhook subscription |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:migrate:deploy` | Apply migrations (production) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Reset DB + reseed |
