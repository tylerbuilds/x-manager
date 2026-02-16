import { NextResponse } from "next/server";

export type ErrorCode =
  | "ACCOUNT_NOT_CONNECTED"
  | "RATE_LIMIT_EXCEEDED"
  | "POLICY_REJECTED"
  | "INVALID_SLOT"
  | "MISSING_CREDENTIALS"
  | "DUPLICATE_POST"
  | "X_API_ERROR"
  | "MEDIA_UPLOAD_FAILED"
  | "APPROVAL_REQUIRED"
  | "VALIDATION_ERROR"
  | "BRIDGE_NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export type ApiErrorResponse = {
  error: string;
  code: ErrorCode;
  userMessage?: string;
  fields?: Record<string, string>;
  retryAfter?: number;
};

const defaultStatusForCode: Record<ErrorCode, number> = {
  ACCOUNT_NOT_CONNECTED: 400,
  RATE_LIMIT_EXCEEDED: 429,
  POLICY_REJECTED: 403,
  INVALID_SLOT: 400,
  MISSING_CREDENTIALS: 503,
  DUPLICATE_POST: 409,
  X_API_ERROR: 502,
  MEDIA_UPLOAD_FAILED: 502,
  APPROVAL_REQUIRED: 202,
  VALIDATION_ERROR: 400,
  BRIDGE_NOT_CONFIGURED: 503,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export { defaultStatusForCode };

export function apiError(
  code: ErrorCode,
  error: string,
  options?: {
    status?: number;
    userMessage?: string;
    fields?: Record<string, string>;
    retryAfter?: number;
  },
): NextResponse<ApiErrorResponse> {
  const status = options?.status ?? defaultStatusForCode[code];

  const body: ApiErrorResponse = { error, code };
  if (options?.userMessage) body.userMessage = options.userMessage;
  if (options?.fields) body.fields = options.fields;
  if (options?.retryAfter !== undefined) body.retryAfter = options.retryAfter;

  const headers: HeadersInit = { "Cache-Control": "no-store" };
  if (options?.retryAfter !== undefined) {
    headers["Retry-After"] = String(options.retryAfter);
  }

  return NextResponse.json(body, { status, headers });
}
