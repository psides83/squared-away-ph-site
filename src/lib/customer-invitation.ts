export function invitationToken(token: unknown, type: unknown) {
  if (
    type !== "invite" ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{20,256}$/.test(token)
  )
    throw Error(
      "This invitation is invalid or expired. Contact the business owner for a new invitation.",
    );
  return token;
}

export async function acceptInvitation(
  auth: {
    verifyOtp: (input: { token_hash: string; type: "invite" }) => Promise<{
      data: { user: { id: string } | null; session: unknown };
      error: unknown;
    }>;
  },
  token: unknown,
  type: unknown,
) {
  const hash = invitationToken(token, type);
  try {
    const result = await auth.verifyOtp({ token_hash: hash, type: "invite" });
    if (result.error || !result.data.user || !result.data.session)
      throw Error();
  } catch {
    throw Error(
      "This invitation is invalid or expired. Contact the business owner for a new invitation.",
    );
  }
}
