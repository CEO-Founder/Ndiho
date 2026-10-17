import "server-only";
import { ApiError } from "./http";

// Fixed-window, in-process rate limiter. Adequate for a single Node instance
// (the standalone deployment); move to Redis if the app is scaled out.
const globalForLimits = globalThis as unknown as {
  __ndihoRateLimits?: Map<string, { count: number; resetAt: number }>;
};
const buckets = (globalForLimits.__ndihoRateLimits ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    throw new ApiError(429, "RATE_LIMITED", `Too many attempts. Try again in ${retryAfter}s.`, {
      retryAfter,
    });
  }
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
