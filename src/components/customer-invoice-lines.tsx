import { money } from "@/lib/format";
export type CustomerInvoiceLine = {
  id: string;
  description: string;
  amount_cents: number | string;
};
export function CustomerInvoiceLines({
  lines,
}: {
  lines: CustomerInvoiceLine[];
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td>{money(Number(line.amount_cents))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
