import type { ButtonHTMLAttributes } from "react";

/** primary = lemon accent (reserved for primary actions). secondary = outlined. */
export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-accent text-accent-ink border border-ink/10 hover:brightness-95",
    secondary: "bg-surface text-ink border border-line hover:bg-wash",
    danger: "bg-surface text-fail border border-fail/40 hover:bg-fail/5",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...rest}
    />
  );
}
