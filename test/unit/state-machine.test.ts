/**
 * Screening state machine unit tests.
 *
 * Tests cover:
 * - Valid state transitions
 * - Invalid state transitions (should throw)
 * - START trigger behavior
 * - Question progression
 * - Completion when last question answered
 */
import { describe, it, expect } from "vitest";
import {
  computeNextState,
  shouldProcessReply,
  stateToQuestionIndex,
  questionIndexToState,
  isTerminalState,
  assertValidTransition,
  QUESTION_STATES,
} from "@/services/screening/state-machine";
import { InvalidStateTransitionError } from "@/lib/errors";

describe("computeNextState", () => {
  describe("STARTED state", () => {
    it("transitions to QUESTION_1 on START reply", () => {
      expect(computeNextState("STARTED", "START", 4)).toBe("QUESTION_1");
    });

    it("transitions to QUESTION_1 on lowercase start", () => {
      expect(computeNextState("STARTED", "start", 4)).toBe("QUESTION_1");
    });

    it("transitions to QUESTION_1 with surrounding whitespace", () => {
      expect(computeNextState("STARTED", "  START  ", 4)).toBe("QUESTION_1");
    });

    it("stays in STARTED for non-START replies", () => {
      expect(computeNextState("STARTED", "Yes", 4)).toBe("STARTED");
      expect(computeNextState("STARTED", "hello", 4)).toBe("STARTED");
      expect(computeNextState("STARTED", "", 4)).toBe("STARTED");
    });

    it("transitions to COMPLETED if no questions exist", () => {
      expect(computeNextState("STARTED", "START", 0)).toBe("COMPLETED");
    });
  });

  describe("question state progression", () => {
    it("QUESTION_1 → QUESTION_2 with any reply (4 questions)", () => {
      expect(computeNextState("QUESTION_1", "5 years", 4)).toBe("QUESTION_2");
    });

    it("QUESTION_2 → QUESTION_3 with any reply", () => {
      expect(computeNextState("QUESTION_2", "Yes", 4)).toBe("QUESTION_3");
    });

    it("QUESTION_3 → QUESTION_4 with any reply", () => {
      expect(computeNextState("QUESTION_3", "Yes", 4)).toBe("QUESTION_4");
    });

    it("QUESTION_4 → COMPLETED (last question answered)", () => {
      expect(computeNextState("QUESTION_4", "Yes", 4)).toBe("COMPLETED");
    });

    it("QUESTION_1 → COMPLETED when only 1 question", () => {
      expect(computeNextState("QUESTION_1", "answer", 1)).toBe("COMPLETED");
    });

    it("QUESTION_2 → COMPLETED when only 2 questions", () => {
      expect(computeNextState("QUESTION_2", "answer", 2)).toBe("COMPLETED");
    });
  });

  describe("terminal states", () => {
    it("throws on COMPLETED", () => {
      expect(() => computeNextState("COMPLETED", "anything", 4)).toThrow(
        InvalidStateTransitionError
      );
    });

    it("throws on FAILED", () => {
      expect(() => computeNextState("FAILED", "anything", 4)).toThrow(
        InvalidStateTransitionError
      );
    });

    it("throws on PENDING (no inbound expected)", () => {
      expect(() => computeNextState("PENDING", "anything", 4)).toThrow(
        InvalidStateTransitionError
      );
    });
  });
});

describe("assertValidTransition", () => {
  it("allows PENDING → STARTED", () => {
    expect(() => assertValidTransition("PENDING", "STARTED")).not.toThrow();
  });

  it("allows STARTED → QUESTION_1", () => {
    expect(() => assertValidTransition("STARTED", "QUESTION_1")).not.toThrow();
  });

  it("allows any state → FAILED", () => {
    expect(() => assertValidTransition("QUESTION_2", "FAILED")).not.toThrow();
  });

  it("rejects COMPLETED → anything", () => {
    expect(() => assertValidTransition("COMPLETED", "STARTED")).toThrow(
      InvalidStateTransitionError
    );
  });

  it("rejects PENDING → COMPLETED (skipping steps)", () => {
    expect(() => assertValidTransition("PENDING", "COMPLETED")).toThrow(
      InvalidStateTransitionError
    );
  });

  it("rejects QUESTION_4 → QUESTION_1 (going backwards)", () => {
    expect(() => assertValidTransition("QUESTION_4", "QUESTION_1")).toThrow(
      InvalidStateTransitionError
    );
  });
});

describe("shouldProcessReply", () => {
  it("returns true for active states", () => {
    expect(shouldProcessReply("STARTED")).toBe(true);
    expect(shouldProcessReply("QUESTION_1")).toBe(true);
    expect(shouldProcessReply("QUESTION_4")).toBe(true);
  });

  it("returns false for terminal states", () => {
    expect(shouldProcessReply("COMPLETED")).toBe(false);
    expect(shouldProcessReply("FAILED")).toBe(false);
  });

  it("returns false for PENDING", () => {
    expect(shouldProcessReply("PENDING")).toBe(false);
  });
});

describe("isTerminalState", () => {
  it("identifies COMPLETED and FAILED as terminal", () => {
    expect(isTerminalState("COMPLETED")).toBe(true);
    expect(isTerminalState("FAILED")).toBe(true);
  });

  it("does not mark active states as terminal", () => {
    for (const state of ["PENDING", "STARTED", ...QUESTION_STATES]) {
      expect(isTerminalState(state as never)).toBe(false);
    }
  });
});

describe("stateToQuestionIndex / questionIndexToState", () => {
  it("maps states to indices correctly", () => {
    expect(stateToQuestionIndex("QUESTION_1")).toBe(0);
    expect(stateToQuestionIndex("QUESTION_2")).toBe(1);
    expect(stateToQuestionIndex("QUESTION_3")).toBe(2);
    expect(stateToQuestionIndex("QUESTION_4")).toBe(3);
  });

  it("returns -1 for non-question states", () => {
    expect(stateToQuestionIndex("COMPLETED")).toBe(-1);
    expect(stateToQuestionIndex("STARTED")).toBe(-1);
  });

  it("maps indices to states correctly", () => {
    expect(questionIndexToState(0)).toBe("QUESTION_1");
    expect(questionIndexToState(3)).toBe("QUESTION_4");
  });

  it("returns null for out-of-range index", () => {
    expect(questionIndexToState(-1)).toBeNull();
    expect(questionIndexToState(99)).toBeNull();
  });
});
