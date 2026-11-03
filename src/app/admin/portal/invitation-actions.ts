"use server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { identifier, text } from "@/lib/validation";
import { recoveryOrigin } from "@/lib/password-recovery";
import { sendCustomerInvitation } from "@/lib/send-customer-invitation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function inviteCustomer(
  _state: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const { db } = await requireAdmin();
  let customer = "";
  let result = "";
  try {
    customer = identifier(form, "customer_id", true)!;
    const request = identifier(form, "request_id", true)!;
    const email = text(form, "email", true, 254)!;
    const key =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const ready =
      process.env.CUSTOMER_INVITES_ENABLED === "true" &&
      process.env.VERCEL_ENV === "production" &&
      Boolean(key && url);
    if (!ready)
      throw Error(
        "Customer invitation sending needs a configured email sender. Contact the site administrator.",
      );
    const origin = recoveryOrigin(process.env.NEXT_PUBLIC_SITE_URL, true);
    const service = createClient(url!, key!, {
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
              AbortSignal.timeout(15000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
    });
    result = await sendCustomerInvitation({
      ready,
      reserve: async () => {
        const { data, error } = await db.rpc("begin_customer_invitation", {
          p_id: request,
          p_customer: customer,
          p_email: email,
        });
        if (error)
          throw Error(
            error.code === "P0001"
              ? error.message
              : "Invitation could not be prepared. Check the latest migration.",
          );
        if (
          !data ||
          typeof data.send !== "boolean" ||
          typeof data.email !== "string"
        )
          throw Error("Invitation could not be prepared.");
        return data;
      },
      invite: async (address) => {
        const { data, error } = await service.auth.admin.inviteUserByEmail(
          address,
          { redirectTo: `${origin}/auth/invite` },
        );
        return !error && Boolean(data.user);
      },
      finish: async (accepted) => {
        const { error } = await service.rpc("finish_customer_invitation", {
          p_id: request,
          p_accepted: accepted,
        });
        if (error)
          throw Error(
            "The result could not be recorded. Review Authentication and invitation history before trying again.",
          );
      },
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Invitation could not be sent.",
    };
  }
  revalidatePath("/admin/portal");
  redirect(
    `/admin/portal?customer=${customer}&success=${encodeURIComponent(result === "previous" ? "This invitation was already attempted. Review its history; no duplicate email was sent." : "Invitation accepted by the email service. Delivery is not confirmed. Link the account separately after review.")}`,
  );
}
