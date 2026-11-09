import { fmtMoney } from "@/lib/money";

/** Tabular, right-aligned money. Use inside table cells for money columns. */
export function Money({ value, currency = "USD", className = "" }: { value: number; currency?: string; className?: string }) {
  return <span className={`tabular block text-right ${className}`}>{fmtMoney(value, currency)}</span>;
}
