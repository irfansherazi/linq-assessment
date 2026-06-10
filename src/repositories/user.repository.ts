/**
 * User repository — authentication-related data access.
 */
import type { User, PasswordResetToken } from "@/generated/prisma";
import { db } from "@/lib/db";

export const userRepository = {
  async findById(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  },

  async findByEmail(email: string): Promise<User | null> {
    return db.user.findUnique({ where: { email } });
  },

  async create(data: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<User> {
    return db.user.create({ data });
  },

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    return db.user.update({ where: { id }, data: { passwordHash } });
  },

  // ── Password Reset Tokens ────────────────────────────────────────────

  async createPasswordResetToken(data: {
    token: string; // hashed
    userId: string;
    expiresAt: Date;
  }): Promise<PasswordResetToken> {
    // Invalidate any existing tokens for this user
    await db.passwordResetToken.deleteMany({
      where: { userId: data.userId, usedAt: null },
    });
    return db.passwordResetToken.create({ data });
  },

  async findPasswordResetToken(
    token: string
  ): Promise<PasswordResetToken | null> {
    return db.passwordResetToken.findUnique({ where: { token } });
  },

  async markPasswordResetTokenUsed(id: string): Promise<PasswordResetToken> {
    return db.passwordResetToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  },

  async deleteExpiredTokens(): Promise<void> {
    await db.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  },
};
