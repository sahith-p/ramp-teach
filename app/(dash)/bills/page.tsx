import Link from "next/link";
import { readBills } from "@/lib/store/bills";
import { fmtMoney } from "@/lib/money";
import { BillStatusBadge, FixtureLabel, PageTitle, Table, link, td, tdMoney, th, thMoney } from "@/components/fixtures/FixtureChrome";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bills · Fixture bill inbox" };

export default function BillsInbox() {
  const bills = readBills();
  const pending = bills.filter((b) => b.status === "pending").length;
  return (
    <div>
      <FixtureLabel app="bills" />
      <PageTitle sub={`${bills.length} bills · ${pending} pending review. Receipts are attached by a human, never by the agent.`}>
        Bill inbox
      </PageTitle>
      <Table caption="Bills">
        <thead>
          <tr>
            <th scope="col" className={th}>Bill</th>
            <th scope="col" className={th}>Vendor</th>
            <th scope="col" className={thMoney}>Amount</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={th}>Receipt attached</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.bill_id} data-bill-id={b.bill_id}>
              <th scope="row" className={`${td} text-left font-medium`}>
                <Link href={`/bills/${b.bill_id}`} className={link}>
                  {b.bill_id}
                </Link>
              </th>
              <td className={td}>{b.vendor}</td>
              <td className={tdMoney}>{fmtMoney(b.amount)}</td>
              <td className={td}>
                <BillStatusBadge status={b.status} />
              </td>
              <td className={td}>
                {b.receipt_id ? (
                  <span>
                    Yes <span className="text-ink-faint">({b.receipt_id})</span>
                  </span>
                ) : (
                  <span className="text-ink-muted">No</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
