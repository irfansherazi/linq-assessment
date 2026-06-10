/**
 * Auth.js v5 (next-auth@beta) configuration.
 *
 * - Credentials provider with bcrypt password verification
 * - JWT sessions (no database sessions — reduces DB round trips on every request)
 * - Custom JWT/session callbacks to include user role + ID
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { userRepository } from "@/repositories/user.repository";
import { authLogger } from "@/lib/logger";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          authLogger.warn({ msg: "Invalid credentials shape" });
          return null;
        }

        const { email, password } = parsed.data;

        const user = await userRepository.findByEmail(email);
        if (!user) {
          authLogger.warn({ msg: "Login attempt for unknown email", email });
          // Constant-time compare even on miss (prevent timing attacks)
          await bcrypt.compare(password, "$2b$12$invalidhashplaceholder000000000000000");
          return null;
        }

        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) {
          authLogger.warn({ msg: "Invalid password", email });
          return null;
        }

        authLogger.info({ msg: "User authenticated", userId: user.id, email });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "RECRUITER";
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
