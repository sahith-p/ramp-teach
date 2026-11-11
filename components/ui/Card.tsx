import type { ReactNode } from "react";

/** Plain card: 1px border, soft radius. `eyebrow` is accepted for old call sites and ignored. */
export function Card({
  title,
  eyebrow: _eyebrow,
  children,
  className = "",
  ...rest
}: {
  title?: ReactNode;
  /** @deprecated Ignored: no eyebrow labels. */
  eyebrow?: ReactNode;
  children: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-6 ${className}`} {...rest}>
      {title && <h2 className="mb-4 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}
