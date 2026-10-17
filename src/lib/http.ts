import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json<T>(data: T, init?: number | ResponseInit): NextResponse {
  const responseInit = typeof init === "number" ? { status: init } : init;
  const res = NextResponse.json(data, responseInit);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status,
    );
  }
  if (err instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields are invalid",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      400,
    );
  }
  console.error("[ndiho] unhandled API error", err);
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } }, 500);
}

/** Wraps a route handler so thrown ApiError/ZodError become JSON responses. */
export function handler<Ctx>(
  fn: (req: NextRequest, ctx: Ctx) => Promise<NextResponse | Response>,
) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * CSRF defence for cookie-authenticated mutations: the request must carry a
 * JSON body (cross-site forms cannot send one without a CORS preflight) and,
 * when the browser sends an Origin header, it must match this site.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new Set(
      (process.env.NDIHO_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    );
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // fall through to rejection
    }
    if (!allowed.has(origin) && originHost !== host) {
      throw new ApiError(403, "FORBIDDEN_ORIGIN", "Cross-site request rejected");
    }
  }
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  assertSameOrigin(req);
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected application/json");
  }
  const raw = await req.text();
  if (raw.length > 64 * 1024) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
  return schema.parse(body);
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
