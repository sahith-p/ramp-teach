import Link from "next/link";
import { loadInvoice, loadVendor } from "@/lib/data";
import { fmtMoney } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { requirePortalSession } from "@/components/fixtures/require-session";
import { invoiceWeekEnding, portalLines } from "@/components/fixtures/portal-data";
import { Field, PageTitle, PortalHeader, Table, link, td, tdMoney, th, thMoney } from "@/components/fixtures/FixtureChrome";

export const metadata = { title: "Invoice · Fixture vendor portal" };

export default async function PortalInvoice({ params }: { params: Promise<{ invoiceId: string }> }) {
  await requirePortalSession();
  const { invoiceId } = await params;
  const id = decodeURIComponent(invoiceId);
  const invoice = loadInvoice(id);

  if (!invoice) {
    return (
      <div>
        <PortalHeader />
        <PageTitle>Invoice not found</PageTitle>
        <p className="text-sm text-ink-muted">
          No invoice with id <code>{id}</code>.{" "}
          <Link href="/portal/invoices" className={link}>
            Back to invoices
          </Link>
        </p>
      </div>
    );
  }

  const vendor = loadVendor();
  const lines = portalLines(invoice, vendor);
  const cur = invoice.currency;

  return (
    <div>
      <PortalHeader />
      <p className="mb-2 text-sm">
        <Link href="/portal/invoices" className={link}>
          ← All invoices
        </Link>
      </p>
      <PageTitle sub={invoice.vendor}>Invoice {invoice.invoice_id}</PageTitle>

      <Card title="Invoice details" className="mb-6">
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Invoice ID" field="invoice_id">{invoice.invoice_id}</Field>
          <Field label="Vendor" field="vendor">{invoice.vendor}</Field>
          <Field label="Week ending" field="week_ending">{invoiceWeekEnding(invoice)}</Field>
          <Field label="Issue date" field="issue_date">{invoice.issue_date}</Field>
          <Field label="Due date" field="due_date">{invoice.due_date}</Field>
          <Field label="Currency" field="currency">{cur}</Field>
        </dl>
      </Card>

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Line items</h2>
      <Table caption={`Line items for invoice ${invoice.invoice_id}`}>
        <thead>
          <tr>
            <th scope="col" className={thMoney}>#</th>
            <th scope="col" className={th}>Description</th>
            <th scope="col" className={th}>Employee</th>
            <th scope="col" className={thMoney}>Hours / qty</th>
            <th scope="col" className={thMoney}>Rate</th>
            <th scope="col" className={thMoney}>Amount</th>
            <th scope="col" className={th}>Timecard</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.index} data-line-index={l.index}>
              <td className={tdMoney}>{l.index + 1}</td>
              <td className={td}>{l.item.description}</td>
              <td className={td}>
                {l.employee ? (
                  <span className="whitespace-nowrap">
                    {l.employee.name} <span className="text-ink-faint">({l.employee.employee_id})</span>
                  </span>
                ) : l.labor ? (
                  <span className="text-warn">{l.labor.employeeName} (not on roster)</span>
                ) : (
                  <span className="text-ink-faint">Non-labor charge</span>
                )}
              </td>
              <td className={tdMoney}>{l.item.quantity}</td>
              <td className={tdMoney}>{fmtMoney(l.item.unit_rate, cur)}</td>
              <td className={tdMoney}>{fmtMoney(l.item.amount, cur)}</td>
              <td className={td}>
                {l.timecardHref ? (
                  <Link href={l.timecardHref} className={`${link} whitespace-nowrap`}>
                    View timecard
                  </Link>
                ) : (
                  <span className="text-ink-faint">n/a</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={5} className="px-4 py-3 text-right font-medium">
              Invoice total
            </th>
            <td className="px-4 py-3 text-right font-semibold tabular" data-field="total">
              {fmtMoney(invoice.total, cur)}
            </td>
            <td className="px-4 py-3" />
          </tr>
        </tfoot>
      </Table>
    </div>
  );
}
