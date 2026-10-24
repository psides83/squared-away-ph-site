import { createECDH } from "node:crypto";
export type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};
export function pushConfig(
  env: Record<string, string | undefined>,
): PushConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    privateKey = env.VAPID_PRIVATE_KEY ?? "",
    subject = env.VAPID_SUBJECT ?? "";
  try {
    if (
      !/^[A-Za-z0-9_-]{87}$/.test(publicKey) ||
      !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
    )
      return null;
    const key = createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (key.getPublicKey().toString("base64url") !== publicKey) return null;
    const url = new URL(subject);
    if (!["https:", "mailto:"].includes(url.protocol)) return null;
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}
export function validatePushSubscription(value: unknown) {
  if (!value || typeof value !== "object")
    throw new Error("Invalid device subscription.");
  const v = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (typeof v.endpoint !== "string" || v.endpoint.length > 2048)
    throw new Error("Invalid push endpoint.");
  const url = new URL(v.endpoint);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname === "/" ||
    !/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(
      url.hostname,
    )
  )
    throw new Error("This browser’s push service is not supported.");
  const p256dh =
    typeof v.keys?.p256dh === "string" ? v.keys.p256dh.replace(/=+$/, "") : "";
  const auth =
    typeof v.keys?.auth === "string" ? v.keys.auth.replace(/=+$/, "") : "";
  if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth))
    throw new Error("Invalid push encryption keys.");
  return { endpoint: v.endpoint, keys: { p256dh, auth } };
}
export function pushMessage(kind: string) {
  if (kind === "supplier")
    return {
      title: "Supplier follow-up",
      body: "An overdue supplier follow-up needs review. Open the app for details.",
      url: "/admin/inventory/recovery",
      tag: "supplier-follow-up",
    };
  if (kind === "scheduler")
    return {
      title: "Scheduled automation needs attention",
      body: "A scheduled barn-office task reported a problem. Open the app to review it.",
      url: "/admin/invoices/recurring",
      tag: "scheduler-failure",
    };
  if (kind === "test")
    return {
      title: "Squared Away notifications",
      body: "This device is connected. Your notification test is ready to view.",
      url: "/admin/settings/notifications",
      tag: "squared-away-test",
    };
  throw new Error("Unknown alert type.");
}
