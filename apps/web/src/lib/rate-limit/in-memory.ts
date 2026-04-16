// Minimal in-memory sliding-window rate limiter.
//
// This lives in the Node process so it's per-instance — on Vercel
// serverless that means per-cold-container. Acceptable for v1 because:
// * Fresh containers warm quickly; an attacker can't just keep
//   spawning new ones to bypass.
// * The LEGITIMATE limit (a producer can issue ~5 links/min) is far
//   below what a single container serves anyway.
// * When we need cross-instance limits (Phase 2), swap the impl for
//   Upstash's @upstash/ratelimit. Same interface.
//
// Map is scoped to module so it persists across the request lifecycle
// of a single container. The GC pass removes stale buckets to avoid
// unbounded memory growth.

interface Bucket {
  // Timestamps (ms) of each hit in the current window. Array kept
  // sorted ascending; entries older than `windowMs` are pruned on
  // each check. Memory is O(max requests per window) per bucket.
  hits: number[];
  // Last-touched — used by the GC sweep.
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();
// Periodic cleanup of buckets that haven't been touched in a while.
// This runs opportunistically on check() — no setInterval so we don't
// leak timers in serverless environments.
const GC_INTERVAL_MS = 60_000;
let lastGc = Date.now();

function gcIfStale(now: number, windowMs: number) {
  if (now - lastGc < GC_INTERVAL_MS) return;
  lastGc = now;
  const threshold = now - windowMs * 2;
  for (const [key, bucket] of buckets) {
    if (bucket.lastSeen < threshold) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Record one attempt against `key`. Returns `ok: false` if the bucket
 * has already exceeded `limit` hits in the past `windowMs`.
 *
 * Intended use in Server Actions / API routes:
 * ```
 * const rl = checkRateLimit(`issue:${producerId}`, 10, 60_000);
 * if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
 * ```
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  gcIfStale(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [], lastSeen: now };
  // Prune entries older than the window.
  const cutoff = now - windowMs;
  while (bucket.hits.length > 0) {
    const head = bucket.hits[0];
    if (head === undefined || head >= cutoff) break;
    bucket.hits.shift();
  }

  if (bucket.hits.length >= limit) {
    const oldestInWindow = bucket.hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      resetMs: Math.max(0, oldestInWindow + windowMs - now),
    };
  }

  bucket.hits.push(now);
  bucket.lastSeen = now;
  buckets.set(key, bucket);

  return {
    ok: true,
    remaining: limit - bucket.hits.length,
    resetMs: windowMs,
  };
}
