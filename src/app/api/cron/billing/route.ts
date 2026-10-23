import { createClient } from "@supabase/supabase-js";
import { handleBillingCron } from "@/lib/billing-cron";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
      const { data, error } = await db
        .rpc("run_scheduled_automations")
        .abortSignal(AbortSignal.timeout(45000));
      if (error || !data?.state) throw new Error("Billing worker failed");
      return data;
    },
  );
}
