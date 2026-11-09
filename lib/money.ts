export const fmtMoney = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);

/** Round to cents, avoiding float drift. */
export const cents = (n: number) => Math.round(n * 100) / 100;
export const moneyEq = (a: number, b: number) => Math.abs(a - b) < 0.005 + 1e-9;
