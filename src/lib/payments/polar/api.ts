/**
 * The few Polar API calls Supaffi makes, over plain fetch.
 *
 * Every sale, renewal, refund and cancellation arrives as a webhook carrying
 * the whole object, so nothing here reads orders: the token is only used to
 * manage the product's webhook endpoint.
 *
 * The API version is pinned with the Polar-Version header, so a webhook
 * endpoint Supaffi creates delivers payloads in the shape this code reads.
 * Polar keeps a version for about nine months ("Each version lives about 9
 * months", polar.sh/docs/api-reference/2026-10/versioning).
 */
export const POLAR_API_VERSION = "2026-10";

const PRODUCTION = "https://api.polar.sh";
const SANDBOX = "https://sandbox-api.polar.sh";

export type PolarConnection = { token: string; sandbox: boolean };

/** An error answer from Polar. Its body is never kept: only the status and Polar's error type. */
export class PolarApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: string
  ) {
    super(`Polar error ${status}/${errorType}`);
    this.name = "PolarApiError";
  }
}

// Unset on every real install. The end-to-end suite points it at its fake
// Polar (e2e/), the only way to run the whole chain without a real account.
function baseUrl(sandbox: boolean): string {
  const override = process.env.SUPAFFI_POLAR_API_BASE?.trim();
  if (override) return override.replace(/\/$/, "");
  return sandbox ? SANDBOX : PRODUCTION;
}

export async function polarRequest<T>(
  connection: PolarConnection,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(connection.sandbox)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Polar-Version": POLAR_API_VERSION,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PolarApiError(0, "unreachable");
  }
  if (!response.ok) {
    let errorType = "unknown";
    try {
      const parsed = (await response.json()) as { error?: unknown };
      if (typeof parsed.error === "string") errorType = parsed.error;
    } catch {
      // Not JSON: the status says enough.
    }
    throw new PolarApiError(response.status, errorType);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function isPolarApiError(err: unknown): err is PolarApiError {
  return err instanceof PolarApiError;
}

/** Text for a log line: a Polar error by its status and type, anything else by its message. */
export function polarLoggableError(err: unknown): string {
  if (isPolarApiError(err)) return err.message;
  return err instanceof Error ? err.message : String(err);
}
