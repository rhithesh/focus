import { charge, type Kind } from "@/lib/ratelimit";

// The free tier's shared plumbing: read and check the extension's request, charge it against
// the limits, forward it to Jev with our key, and refund the charge if Jev never answers.
// Nothing about the posts or pictures is stored or logged; only hashed counters are kept.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);
export const isFlat = (v: Json, max: number) => (typeof v === "string" ? v.length <= max : typeof v === "number" || typeof v === "boolean");

export const apiKey = () => process.env.OPENROUTER_API_KEY || process.env.JEV_API_KEY || "";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/;

export function caller(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const raw = req.headers.get("x-feed-filter-install") || "";
  return { ip, install: INSTALL_ID.test(raw) ? raw : "ip:" + ip };
}

export type Checked = { ok: true; body: Record<string, Json>; items: number } | { ok: false; error: string };

export async function relay(
  req: Request,
  opts: { kind: Kind; maxBody: number; check: (body: unknown) => Checked; upstream: string; timeoutMs: number }
) {
  if (!apiKey()) return json({ error: "free-tier-off", message: "The free tier is not configured on this server." }, 503);

  const text = await req.text();
  if (text.length > opts.maxBody) return json({ error: "too-large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad-json" }, 400);
  }
  const v = opts.check(body);
  if (!v.ok) return json({ error: "bad-request", message: v.error }, 400);

  const who = caller(req);
  let bill;
  try {
    bill = await charge(who.ip, who.install, v.items, opts.kind);
  } catch {
    // Fail closed: without working counters there is no spend limit.
    return json({ error: "unavailable", message: "Rate limiter unavailable." }, 503, { "Retry-After": "60" });
  }
  if (!bill.ok) {
    return json(
      { error: "limit", scope: bill.scope, limit: bill.limit, remaining: bill.remaining, retryAfter: bill.retryAfter },
      429,
      { "Retry-After": String(bill.retryAfter) }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(opts.upstream, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "X-Title": "Focus (free tier)",
      },
      body: JSON.stringify(v.body),
      signal: AbortSignal.timeout(opts.timeoutMs),
      cache: "no-store",
    });
  } catch {
    await bill.refund().catch(() => {});
    return json({ error: "upstream", message: "Could not reach the model." }, 502);
  }

  if (!upstream.ok) {
    await bill.refund().catch(() => {});
    const busy = upstream.status === 429 || upstream.status === 529;
    return json(
      { error: busy ? "busy" : "upstream", status: upstream.status },
      busy ? 503 : 502,
      busy ? { "Retry-After": upstream.headers.get("retry-after") || "5" } : {}
    );
  }

  const data = (await upstream.json()) as { answers?: unknown; model?: string; usage?: unknown };
  // Allowance headers only when there is a per-install allowance to report.
  const allowance: Record<string, string> = Number.isFinite(bill.limit)
    ? { "X-RateLimit-Limit": String(bill.limit), "X-RateLimit-Remaining": String(bill.remaining), "X-RateLimit-Reset": String(bill.resetSeconds) }
    : {};
  return json({ answers: data.answers ?? {}, model: data.model ?? v.body.model, usage: data.usage }, 200, allowance);
}
