/**
 * Auth.js v5 catch-all route handler.
 * Handles all /api/auth/* endpoints (login, logout, session, etc.)
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
