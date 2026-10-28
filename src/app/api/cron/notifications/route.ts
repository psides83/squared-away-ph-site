import { createClient } from "@supabase/supabase-js";
import { handlePushCron } from "@/lib/push-cron";
import { frequentPushConfigured } from "@/lib/push-time";
import { pushConfig } from "@/lib/web-push";
import { deliverAdminPush } from "@/lib/push-delivery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const config = pushConfig(process.env);
  return handlePushCron(
    request,
    {
      secret: process.env.PUSH_CRON_SECRET,
      production: process.env.VERCEL_ENV === "production",
      configured:
        Boolean(url && key && config) && frequentPushConfigured(process.env),
    },
    async () => {
      const db = createClient(url!, key!, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      // This route can only dispatch notifications; it never invokes financial automation.
      return deliverAdminPush(db, config!, false, 10, true);
    },
  );
}
