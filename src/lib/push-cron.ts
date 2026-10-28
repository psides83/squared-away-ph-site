import { timingSafeEqual } from "node:crypto";
export async function handlePushCron(
  request: Request,
  config: { secret?: string; production: boolean; configured: boolean },
  run: () => Promise<{ accepted: number; failed: number }>,
) {
  const respond = (body: object, status: number) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  if (request.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  if (!config.secret || config.secret.length < 32)
    return respond({ error: "Notification checks are not configured." }, 503);
  const expected = Buffer.from(`Bearer ${config.secret}`),
    supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return respond({ error: "Unauthorized" }, 401);
  if (!config.production || !config.configured)
    return respond(
      { error: "Notification checks are unavailable in this environment." },
      503,
    );
  try {
    const result = await run();
    return respond(result, result.failed > 0 ? 500 : 200);
  } catch {
    return respond(
      { error: "Notification check failed. Review deployment logs." },
      500,
    );
  }
}
