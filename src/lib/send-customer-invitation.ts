export async function sendCustomerInvitation(worker: {
  ready: boolean;
  reserve: () => Promise<{ send: boolean; email: string }>;
  invite: (email: string) => Promise<boolean>;
  finish: (accepted: boolean) => Promise<void>;
}) {
  if (!worker.ready)
    throw Error(
      "Customer invitation sending needs a configured email sender. Contact the site administrator.",
    );
  const reservation = await worker.reserve();
  if (!reservation.send) return "previous" as const;
  let accepted = false;
  try {
    accepted = await worker.invite(reservation.email);
  } catch {
    /* Never retry uncertain provider calls automatically. */
  }
  await worker.finish(accepted);
  if (!accepted)
    throw Error(
      "The invitation attempt needs provider review. Check Authentication before trying again; no customer access was granted.",
    );
  return "accepted" as const;
}
