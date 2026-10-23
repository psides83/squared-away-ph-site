import { redirect } from "next/navigation";

/** Preserve existing return links and action redirects within inventory tabs. */
export default async function Returns({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ section: "returns" });
  for (const key of ["page", "return", "refund_page", "success", "error"]) {
    const value = params[key];
    if (typeof value === "string")
      query.set(key === "page" ? "returns_page" : key, value);
  }
  redirect(
    `/admin/inventory?${query}#${typeof params.return === "string" && /^[0-9a-f-]{36}$/i.test(params.return) ? `return-${params.return}` : "inventory-returns"}`,
  );
}
