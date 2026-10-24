"use server";
import { sendDevicePush } from "@/lib/push-delivery";
import { requireAdmin } from "@/lib/auth";
import { pushConfig, validatePushSubscription } from "@/lib/web-push";
import { identifier, text } from "@/lib/validation";
import { revalidatePath } from "next/cache";
export async function registerPushDevice(
  subscription: unknown,
  label: string,
  supplier: boolean,
  scheduler: boolean,
): Promise<{ error?: string; id?: string }> {
  const { db } = await requireAdmin();
  try {
    const config = pushConfig(process.env);
    if (!config || process.env.VERCEL_ENV !== "production")
      throw new Error("Push delivery is not configured in this environment.");
    if (
      typeof label !== "string" ||
      !label.trim() ||
      label.trim().length > 80 ||
      typeof supplier !== "boolean" ||
      typeof scheduler !== "boolean"
    )
      throw new Error("Enter a device name and preferences.");
    const sub = validatePushSubscription(subscription);
    const { data, error } = await db.rpc("save_admin_push_device", {
      p_endpoint: sub.endpoint,
      p_p256dh: sub.keys.p256dh,
      p_auth: sub.keys.auth,
      p_public: config.publicKey,
      p_label: label.trim(),
      p_supplier: supplier,
      p_scheduler: scheduler,
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Device registration could not be saved. Try again.",
      );
    revalidatePath("/admin/settings/notifications");
    return { id: data };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Device registration could not be saved.",
    };
  }
}
export async function savePushPreferences(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc("update_admin_push_device", {
      p_id: identifier(form, "id", true),
      p_label: text(form, "label", true, 80),
      p_supplier: form.get("supplier") === "on",
      p_scheduler: form.get("scheduler") === "on",
      p_enabled: form.get("enabled") === "on",
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Preferences could not be saved.",
      );
    revalidatePath("/admin/settings/notifications");
    return { success: "Device preferences saved." };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Preferences could not be saved.",
    };
  }
}

export async function testPushDevice(
  id: string,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const config = pushConfig(process.env);
    if (!config || process.env.VERCEL_ENV !== "production")
      throw new Error("Push delivery is not configured in this environment.");
    const { data, error } = await db.rpc("reserve_admin_push_test", {
      p_id: id,
      p_public: config.publicKey,
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Could not prepare the device test.",
      );
    const result = await sendDevicePush(config, data, "test");
    if (result.status !== "sent")
      throw new Error(
        result.status === "expired"
          ? "This browser subscription has expired. Reconnect this device."
          : "The push service did not accept the test. Check device permissions and try again later.",
      );
    return {
      success:
        "Test accepted by the push service. Check this device’s notifications; acceptance does not guarantee display.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not send the test notification.",
    };
  }
}
