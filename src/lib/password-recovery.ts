export function recoveryOrigin(value: string | undefined, production: boolean) {
  if (!value)
    throw Error(
      "Account recovery is not configured yet. Contact the business owner.",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error(
      "Account recovery is not configured yet. Contact the business owner.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (!production && local && url.protocol === "http:")
    ) ||
    (production && local)
  )
    throw Error(
      "Account recovery is not configured yet. Contact the business owner.",
    );
  return url.origin;
}
export function recoveryEmail(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  if (email.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error("Enter a valid email address.");
  return email;
}
export function recoveryToken(token: unknown, type: unknown) {
  if (
    type !== "recovery" ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{20,256}$/.test(token)
  )
    throw Error("This reset link is invalid or expired. Request a new link.");
  return token;
}
export function newPassword(form: FormData) {
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  if (password.length < 12 || password.length > 128)
    throw Error("Use a password between 12 and 128 characters.");
  if (password !== confirmation) throw Error("The passwords do not match.");
  return password;
}
export type RecoveryAuth = {
  resetPasswordForEmail: (
    email: string,
    options: { redirectTo: string },
  ) => Promise<unknown>;
  getUser: () => Promise<{
    data: { user: { id: string } | null };
    error: unknown;
  }>;
  updateUser: (data: { password: string }) => Promise<{ error: unknown }>;
  signOut: (options: { scope: "global" }) => Promise<unknown>;
};
export async function sendRecovery(
  auth: Pick<RecoveryAuth, "resetPasswordForEmail">,
  email: string,
  origin: string,
) {
  try {
    await auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/recovery`,
    });
  } catch {
    /* Same outward result for unknown accounts, rate limits and delivery errors. */
  }
}
export async function changeRecoveredPassword(
  auth: Pick<RecoveryAuth, "getUser" | "updateUser" | "signOut">,
  password: string,
) {
  try {
    const { data, error } = await auth.getUser();
    if (error || !data.user) throw Error();
  } catch {
    throw Error("Your reset session has expired. Request a new link.");
  }
  try {
    const result = await auth.updateUser({ password });
    if (result.error) throw Error();
  } catch {
    throw Error(
      "Password could not be updated. Request a new link or choose a different password.",
    );
  }
  try {
    await auth.signOut({ scope: "global" });
  } catch {
    /* Password was already saved; never report it as unchanged. */
  }
}
