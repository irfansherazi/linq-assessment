/**
 * Screening workflow state machine.
 *
 * Design principles:
 * - Transitions are declared in an explicit table — no if/else chains
 * - States are derived from the number of active ScreeningQuestions
 *   (expandable: add a question row → new state appears automatically)
 * - The engine is pure: it accepts current state + input, returns next state
 * - Side effects (DB writes, SMS sends) are handled in the workflow engine
 *
 * State flow:
 *
 *   PENDING
 *     │ (recruiter launches screening)
 *     ▼
 *   STARTED  ←── waiting for "START" reply
 *     │ (candidate replies START)
 *     ▼
 *   QUESTION_1
 *     │ (any reply)
 *     ▼
 *   QUESTION_2
 *     ...
 *     ▼
 *   QUESTION_N
 *     │ (any reply)
 *     ▼
 *   COMPLETED
 *
 *   Any state → FAILED (on delivery failure / timeout)
 */
import type { ScreeningState } from "@/generated/prisma";
import { InvalidStateTransitionError } from "@/lib/errors";

export const SCREENING_STATES: ScreeningState[] = [
  "PENDING",
  "STARTED",
  "QUESTION_1",
  "QUESTION_2",
  "QUESTION_3",
  "QUESTION_4",
  "COMPLETED",
  "FAILED",
];

export const QUESTION_STATES: ScreeningState[] = [
  "QUESTION_1",
  "QUESTION_2",
  "QUESTION_3",
  "QUESTION_4",
];

export const TERMINAL_STATES: ScreeningState[] = ["COMPLETED", "FAILED"];

/** The text a candidate must send to start the screening */
export const START_TRIGGER = "START";

/**
 * Get the question state for a given 0-based question index.
 * Returns null if the index is out of range.
 */
export function questionIndexToState(
  index: number
): ScreeningState | null {
  if (index < 0 || index >= QUESTION_STATES.length) return null;
  return QUESTION_STATES[index];
}

/**
 * Get the 0-based question index for a question state.
 * Returns -1 if not a question state.
 */
export function stateToQuestionIndex(state: ScreeningState): number {
  return QUESTION_STATES.indexOf(state);
}

export function isTerminalState(state: ScreeningState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isQuestionState(state: ScreeningState): boolean {
  return QUESTION_STATES.includes(state);
}

/**
 * Explicit transition table.
 * Key = current state; value = allowed next states.
 *
 * FAILED is reachable from any non-terminal state (handled separately).
 */
const TRANSITION_TABLE: Partial<Record<ScreeningState, ScreeningState[]>> = {
  PENDING: ["STARTED"],
  STARTED: ["QUESTION_1", "FAILED"],
  QUESTION_1: ["QUESTION_2", "COMPLETED", "FAILED"],
  QUESTION_2: ["QUESTION_3", "COMPLETED", "FAILED"],
  QUESTION_3: ["QUESTION_4", "COMPLETED", "FAILED"],
  QUESTION_4: ["COMPLETED", "FAILED"],
};

/**
 * Validate that a state transition is allowed.
 * @throws InvalidStateTransitionError if the transition is illegal.
 */
export function assertValidTransition(
  from: ScreeningState,
  to: ScreeningState
): void {
  if (isTerminalState(from)) {
    throw new InvalidStateTransitionError(from, to);
  }

  const allowed = TRANSITION_TABLE[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

/**
 * Determine the next state after a candidate reply.
 *
 * @param currentState - Current screening state
 * @param replyText - The candidate's SMS reply
 * @param totalQuestions - Total number of active questions
 * @returns The next ScreeningState
 * @throws InvalidStateTransitionError if current state is terminal
 */
export function computeNextState(
  currentState: ScreeningState,
  replyText: string,
  totalQuestions: number
): ScreeningState {
  if (isTerminalState(currentState)) {
    throw new InvalidStateTransitionError(currentState, "any");
  }

  // ── PENDING: shouldn't receive inbound (screening not started yet) ─
  if (currentState === "PENDING") {
    throw new InvalidStateTransitionError(currentState, "any");
  }

  // ── STARTED: waiting for "START" ──────────────────────────────────
  if (currentState === "STARTED") {
    if (replyText.trim().toUpperCase() === START_TRIGGER) {
      // Move to first question if questions exist, else complete
      return totalQuestions > 0 ? "QUESTION_1" : "COMPLETED";
    }
    // Ignore non-START replies in this state (return same state)
    return "STARTED";
  }

  // ── QUESTION_N: any reply advances to next question or completes ──
  if (isQuestionState(currentState)) {
    const currentIndex = stateToQuestionIndex(currentState);
    const nextIndex = currentIndex + 1;

    if (nextIndex >= totalQuestions) {
      // All questions answered
      return "COMPLETED";
    }

    const nextState = questionIndexToState(nextIndex);
    if (!nextState) {
      return "COMPLETED";
    }
    return nextState;
  }

  throw new InvalidStateTransitionError(currentState, "unknown");
}

/**
 * Check if a reply is valid/expected for the current state.
 * Used to decide whether to process or ignore a message.
 */
export function shouldProcessReply(state: ScreeningState): boolean {
  return !isTerminalState(state) && state !== "PENDING";
}
