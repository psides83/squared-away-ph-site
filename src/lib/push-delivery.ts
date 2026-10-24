import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pushMessage,
  validatePushSubscription,
  type PushConfig,
} from "./web-push.ts";
export async function deliverAdminPush(
  db: SupabaseClient,
  config: PushConfig,
  schedulerFailed: boolean,
) {
  const { data, error } = await db
    .rpc("claim_admin_push", {
      p_public: config.publicKey,
      p_scheduler_failed: schedulerFailed,
    })
    .abortSignal(AbortSignal.timeout(5000));
  if (error) throw new Error("Push queue could not be checked");
  const jobs = data as {
    id: string;
    kind: string;
    lease_token: string;
    endpoint: string;
    p256dh: string;
    auth_key: string;
  }[];
  let accepted = 0,
    failed = 0;
  for (let start = 0; start < jobs.length; start += 5) {
    await Promise.all(
      jobs.slice(start, start + 5).map(async (job) => {
        let status = "failed",
          code: number | null = null;
        const result = await sendDevicePush(
          config,
          {
            endpoint: job.endpoint,
            keys: { p256dh: job.p256dh, auth: job.auth_key },
          },
          job.kind,
        );
        status = result.status;
        code = result.code;
        const saved = await db
          .rpc("finish_admin_push", {
            p_id: job.id,
            p_token: job.lease_token,
            p_status: status,
            p_code: code,
          })
          .abortSignal(AbortSignal.timeout(5000));
        if (saved.error || status === "failed") failed++;
        else if (status === "sent") accepted++;
      }),
    );
  }
  return { accepted, failed };
}

export async function sendDevicePush(
  config: PushConfig,
  subscription: unknown,
  kind: string,
): Promise<{ status: "sent" | "failed" | "expired"; code: number | null }> {
  try {
    const sub = validatePushSubscription(subscription);
    const request = webpush.generateRequestDetails(
      sub,
      JSON.stringify(pushMessage(kind)),
      {
        TTL: 3600,
        urgency: "normal",
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
      },
    );
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers as Record<string, string>,
      body: request.body ? new Uint8Array(request.body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(4000),
    });
    const code = response.status;
    await response.body?.cancel();
    return {
      status: response.ok
        ? "sent"
        : [404, 410].includes(code)
          ? "expired"
          : "failed",
      code,
    };
  } catch {
    return { status: "failed", code: null };
  }
}
