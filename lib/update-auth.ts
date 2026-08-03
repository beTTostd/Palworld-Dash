import { scryptSync, timingSafeEqual } from "node:crypto";

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

export function validUpdatePassword(password: string) {
  const encoded = process.env.UPDATE_PASSWORD_HASH;
  if (!encoded || password.length < 1) return false;
  const [scheme, salt, expected] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, Buffer.from(salt, "base64"), 32);
  const target = Buffer.from(expected, "base64");
  return target.length === actual.length && timingSafeEqual(target, actual);
}
