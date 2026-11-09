import Link from "next/link";
import { invoiceIdFromBillId, receiptIdFor } from "@/contracts";
import { getBill } from "@/lib/store/bills";
import { readReceipt } from "@/lib/store/receipts";
import { fmtMoney } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ModeBadge } from "@/components/ui/Badge";
import { firstParam } from "@/components/fixtures/portal-data";
import { BillStatusBadge, Field, FixtureLabel, PageTitle, link } from "@/components/fixtures/FixtureChrome";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bill — Fixture bill inbox" };

const recWord = { approve: "Approve", dispute: "Dispute", review: "Review" } as const;
const decisionWord = { approve: "Approved", dispute: "Disputed" } as const;

export default async function BillDetail({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const billId = decodeURIComponent((await params).billId);
  const sp = await searchParams;
  const attached = firstParam(sp.attached) === "1";
  const error = firstParam(sp.error);
  const bill = getBill(billId);

  if (!bill) {
    return (
      <div>
        <FixtureLabel app="bills" />
        <PageTitle>Bill not found</PageTitle>
        <p className="text-sm text-ink-muted">
          No bill with id <code>{billId}</code>.{" "}
          <Link href="/bills" className={link}>
            Back to bill inbox
          </Link>
        </p>
      </div>
    );
  }

  const invoiceId = invoiceIdFromBillId(bill.bill_id);
  const receiptId = receiptIdFor(invoiceId);
  const receipt = readReceipt(invoiceId);

  return (
    <div>
      <FixtureLabel app="bills" />
      <p className="mb-2 text-sm">
        <Link href="/bills" className={link}>
          ← Bill inbox
        </Link>
      </p>
      <PageTitle sub={bill.vendor}>Bill {bill.bill_id}</PageTitle>

      {attached && (
        <p role="status" className="mb-6 rounded-lg border border-pass/30 bg-pass/5 px-3 py-2 text-sm text-pass">
          Receipt {bill.receipt_id} attached to this bill.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-6 rounded-lg border border-fail/30 bg-fail/5 px-3 py-2 text-sm text-fail">
          Could not attach receipt: {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Bill details">
          <dl className="grid grid-cols-2 gap-6">
            <Field label="Bill ID" field="bill_id">{bill.bill_id}</Field>
            <Field label="Invoice" field="invoice_id">{invoiceId}</Field>
            <Field label="Vendor" field="vendor">{bill.vendor}</Field>
            <Field label="Amount" field="amount">
              <span className="tabular">{fmtMoney(bill.amount)}</span>
            </Field>
            <Field label="Status" field="bill_status">
              <BillStatusBadge status={bill.status} />
            </Field>
            <Field label="Receipt attached" field="receipt_id">
              {bill.receipt_id ?? "None"}
            </Field>
          </dl>
        </Card>

        <Card title="Verification receipt">
          {bill.receipt_id ? (
            receipt ? (
              <dl className="grid grid-cols-1 gap-6">
                <Field label="Agent recommendation" field="recommendation">
                  <span className="font-display text-2xl">{recWord[receipt.recommendation]}</span>
                  <span className="ml-3 align-middle">
                    <ModeBadge mode={receipt.mode} />
                  </span>
                </Field>
                <Field label="Human decision" field="human_decision">
                  {receipt.human_decision ? (
                    <span>
                      {decisionWord[receipt.human_decision]}
                      {receipt.decided_by ? ` by ${receipt.decided_by}` : ""}
                      {receipt.decided_at ? ` on ${receipt.decided_at}` : ""}
                    </span>
                  ) : (
                    <span className="text-ink-muted">Awaiting human decision</span>
                  )}
                </Field>
                <div>
                  <Link href={`/receipts/${invoiceId}`} className={link}>
                    Open receipt for {invoiceId}
                  </Link>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-warn">
                Receipt {bill.receipt_id} is attached, but receipts/{invoiceId}.json is missing.
              </p>
            )
          ) : receipt ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-ink-muted">
                A verification receipt exists for {invoiceId} (agent recommendation:{" "}
                <strong className="text-ink">{recWord[receipt.recommendation]}</strong>). It is not attached yet.{" "}
                <Link href={`/receipts/${invoiceId}`} className={link}>
                  Review the receipt
                </Link>{" "}
                before attaching.
              </p>
              <form action={`/api/bills/${bill.bill_id}/attach`} method="post">
                <input type="hidden" name="receipt_id" value={receiptId} />
                <Button type="submit" variant="primary">
                  Attach receipt
                </Button>
              </form>
              <p className="text-xs text-ink-faint">Human action. The agent never attaches receipts.</p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              No receipt yet for {invoiceId}. The agent writes one with <code className="whitespace-nowrap">npm run agent -- {invoiceId}</code>.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
