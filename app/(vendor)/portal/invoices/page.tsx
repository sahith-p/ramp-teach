import Link from "next/link";
import { loadAllInvoices, loadVendor } from "@/lib/data";
import { fmtMoney } from "@/lib/money";
import { requirePortalSession } from "@/components/fixtures/require-session";
import { invoiceWeekEnding } from "@/components/fixtures/portal-data";
import { PageTitle, PortalShell, Table, plink, td, tdMoney, th, thMoney } from "@/components/fixtures/FixtureChrome";

export const metadata = { title: "Invoices · Halcyon Staffing client portal" };

export default async function PortalInvoices() {
  await requirePortalSession();
  // This is Halcyon's portal: only Halcyon's own invoices.
  const vendor = loadVendor().vendor;
  const invoices = loadAllInvoices().filter((inv) => inv.vendor === vendor);
  return (
    <PortalShell>
      <PageTitle>Invoices</PageTitle>
      <Table caption="Invoices">
        <thead>
          <tr>
            <th scope="col" className={th}>Invoice</th>
            <th scope="col" className={th}>Week ending</th>
            <th scope="col" className={th}>Issue date</th>
            <th scope="col" className={th}>Due date</th>
            <th scope="col" className={thMoney}>Lines</th>
            <th scope="col" className={thMoney}>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.invoice_id} data-invoice-id={inv.invoice_id}>
              <th scope="row" className={`${td} text-left font-medium`}>
                <Link href={`/portal/invoices/${inv.invoice_id}`} className={plink}>
                  {inv.invoice_id}
                </Link>
              </th>
              <td className={td}>{invoiceWeekEnding(inv)}</td>
              <td className={td}>{inv.issue_date}</td>
              <td className={td}>{inv.due_date}</td>
              <td className={tdMoney}>{inv.line_items.length}</td>
              <td className={tdMoney}>{fmtMoney(inv.total, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PortalShell>
  );
}
