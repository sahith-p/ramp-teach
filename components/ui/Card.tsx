import type { ReactNode } from "react";

/** Bento card: 1px border, generous padding, soft radius. */
export function Card({
  title,
  eyebrow,
  children,
  className = "",
  ...rest
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-6 ${className}`} {...rest}>
      {eyebrow && <div className="mb-1 text-xs uppercase tracking-wider text-ink-faint">{eyebrow}</div>}
      {title && <h2 className="mb-4 text-lg font-semibold tracking-tight">{title}</h2>}
      {children}
    </section>
  );
}
