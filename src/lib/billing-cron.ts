import { timingSafeEqual } from "node:crypto";
export type BillingCronConfig = {
  secret?: string;
  production: boolean;
  configured: boolean;
};
export async function handleBillingCron(
  request: Request,
  config: BillingCronConfig,
  run: () => Promise<{ state: string; processed?: number }>,
) {
  const respond = (body: object, status: number) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  if (!config.secret || config.secret.length < 32)
    return respond({ error: "Scheduled billing is not configured." }, 503);
  const expected = Buffer.from(`Bearer ${config.secret}`),
    supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return respond({ error: "Unauthorized" }, 401);
  if (!config.production || !config.configured)
    return respond(
      { error: "Scheduled billing is not available in this environment." },
      503,
    );
  try {
    const result = await run();
    const failed = result.state === "error" || result.state === "blocked";
    return respond(
      { state: result.state, processed: result.processed ?? 0 },
      failed ? 500 : 200,
    );
  } catch {
    return respond(
      {
        error:
          "Scheduled billing failed. Check deployment logs and recurring billing history.",
      },
      500,
    );
  }
}
