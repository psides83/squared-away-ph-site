import { cleanupAbandonedVideos } from "@/lib/video-cleanup";
import { pushConfig } from "@/lib/web-push";
import { deliverAdminPush } from "@/lib/push-delivery";
import { createClient } from "@supabase/supabase-js";
import { handleBillingCron } from "@/lib/billing-cron";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return handleBillingCron(
    request,
    {
      secret: process.env.CRON_SECRET,
      production: process.env.VERCEL_ENV === "production",
      configured: Boolean(url && key),
    },
    async () => {
      const db = createClient(url!, key!, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      let result: { state: string; processed?: number } = { state: "error" };
      try {
        const { data, error } = await db
          .rpc("run_scheduled_automations")
          .abortSignal(AbortSignal.timeout(45000));
        if (error || !data?.state) throw new Error("Billing worker failed");
        result = data;
      } catch {
        result = { state: "error" };
      }
      if (process.env.MEDIA_CLEANUP_ENABLED === "true") {
        try {
          const media = createClient(url!, key!, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
            global: {
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  signal: AbortSignal.any([
                    AbortSignal.timeout(5000),
                    ...(init?.signal ? [init.signal] : []),
                  ]),
                }),
            },
          });
          const cleanup = await cleanupAbandonedVideos({
            claim: async () => {
              const { data, error } = await media
                .rpc("claim_abandoned_video_cleanup")
                .abortSignal(AbortSignal.timeout(10000));
              if (error) throw Error("Cleanup unavailable");
              return data;
            },
            remove: async (path) => {
              const { error } = await media.storage
                .from("horse-videos")
                .remove([path]);
              return !error;
            },
            record: async (id, success) => {
              const { error } = await media
                .rpc("record_abandoned_video_cleanup", {
                  p_id: id,
                  p_success: success,
                })
                .abortSignal(AbortSignal.timeout(10000));
              if (error) throw Error("Cleanup result unavailable");
            },
          });
          if (cleanup.failed) result = { ...result, state: "error" };
        } catch {
          result = { ...result, state: "error" };
        }
      }
      const config = pushConfig(process.env);
      if (config) {
        const push = await deliverAdminPush(
          db,
          config,
          ["error", "blocked"].includes(result.state),
        );
        if (push.failed > 0) return { ...result, state: "error" };
      }
      return result;
    },
  );
}
