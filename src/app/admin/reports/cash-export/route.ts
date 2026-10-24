import { requireAdmin } from "@/lib/auth";
import {
  cashLedgerCsv,
  validCashExportPeriod,
  type CashLedgerExport,
} from "@/lib/cash-export";
export async function GET(request: Request) {
  const { db } = await requireAdmin();
  const query = new URL(request.url).searchParams;
  const from = query.get("from") ?? "",
    to = query.get("to") ?? "";
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!validCashExportPeriod(from, to))
    return Response.json(
      { error: "Choose valid dates in order, covering at most ten years." },
      { status: 400, headers },
    );
  const result = await db.rpc("cash_ledger_export", { p_from: from, p_to: to });
  if (result.error || !result.data)
    return Response.json(
      {
        error:
          result.error?.code === "P0001"
            ? result.error.message
            : "The cash export could not load. Check the latest migration and retry.",
      },
      { status: result.error?.code === "P0001" ? 422 : 503, headers },
    );
  try {
    return new Response(cashLedgerCsv(result.data as CashLedgerExport), {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="squared-away-cash-${from}-through-${to}.csv"`,
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "The cash export did not reconcile. Refresh the report and retry.",
      },
      { status: 503, headers },
    );
  }
}
