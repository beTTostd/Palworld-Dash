import { validPalworldAdminPassword } from "@/lib/palworld";

const WINDOW_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function allowAttempt(address: string) {
  const now = Date.now();
  const entry = attempts.get(address);
  if (!entry || entry.resetAt <= now) {
    attempts.set(address, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export async function validUpdatePassword(password: string) {
  return password.length > 0 && validPalworldAdminPassword(password);
}
