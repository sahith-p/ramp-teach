import Link from "next/link";

/** Small segmented control of versions (links). */
export function VersionPicker({ versions, active, href, label }: { versions: number[]; active: number; href: (v: number) => string; label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px]" data-testid="version-picker">
      {label && <span className="text-[rgb(110,106,104)]">{label}</span>}
      <div className="flex border border-[rgb(226,222,219)] bg-white">
        {versions.map((v, i) => (
          <Link
            key={v}
            href={href(v)}
            scroll={false}
            data-version={v}
            className={`tabular flex h-7 min-w-9 items-center justify-center px-2 ${i > 0 ? "border-l border-[rgb(226,222,219)]" : ""} ${v === active ? "bg-[rgb(26,25,25)] text-white" : "text-[rgb(71,69,67)] hover:bg-[rgb(250,249,248)]"}`}
          >
            v{v}
          </Link>
        ))}
      </div>
    </div>
  );
}
