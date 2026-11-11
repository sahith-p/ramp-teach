import Link from "next/link";
import { RampMark } from "./RampLogo";

type Item = { label: string; href?: string; icon: keyof typeof ICONS; children?: { label: string; href?: string; active?: boolean }[] };

/** Same groups and order as Ramp's sidebar. Only Bill Pay > Bills is live in this demo. */
const GROUPS: Item[][] = [
  [{ label: "Home", icon: "home" }],
  [
    { label: "Cards and expenses", icon: "card" },
    { label: "Travel", icon: "travel" },
    { label: "Bill Pay", icon: "bill", children: [{ label: "Bills", href: "/bills", active: true }, { label: "Vendor credits" }] },
    { label: "Procurement", icon: "cart" },
    { label: "Banking", icon: "bank" },
    { label: "AI spend", icon: "dollar" },
  ],
  [
    { label: "Accounting", icon: "book" },
    { label: "Vendors", icon: "store" },
    { label: "Policy", icon: "sliders" },
    { label: "Company", icon: "building" },
  ],
];

const ICONS = {
  home: <path d="M2.5 7 7 3.2 11.5 7v4.8H2.5V7Z" />,
  card: <><rect x="1.8" y="3.5" width="10.4" height="7.5" rx="1" /><path d="M1.8 6h10.4" /></>,
  travel: <path d="M2 8.5 12 4l-2.3 7-2.2-2.5L5 10V8.2" />,
  bill: <><path d="M3 1.8h5.5L11 4.3v7.9H3V1.8Z" /><path d="M5 6.5h4M5 8.8h4" /></>,
  cart: <><path d="M1.8 2.5h1.6l1.2 6.5h6l1.1-4.5H4" /><circle cx="5.5" cy="11.2" r=".7" /><circle cx="9.8" cy="11.2" r=".7" /></>,
  bank: <path d="M2 5.2 7 2.5l5 2.7M3 6v4.5m2.7-4.5v4.5m2.6-4.5v4.5M11 6v4.5M2 11.8h10" />,
  dollar: <path d="M7 1.8v10.4M9.3 4.2C8.9 3.5 8 3.1 7 3.1c-1.3 0-2.3.7-2.3 1.7 0 2.4 4.7 1.2 4.7 3.6 0 1-1 1.8-2.4 1.8-1.1 0-2-.5-2.4-1.3" />,
  book: <path d="M7 3.5c-1.4-1-3.2-1.2-5-1v8.5c1.8-.2 3.6 0 5 1 1.4-1 3.2-1.2 5-1V2.5c-1.8-.2-3.6 0-5 1Zm0 0v8.5" />,
  store: <><path d="M2 5 3 2.5h8L12 5c0 .9-.7 1.5-1.6 1.5S8.8 5.9 8.8 5c0 .9-.7 1.5-1.6 1.5S5.5 5.9 5.5 5c0 .9-.7 1.5-1.6 1.5S2 5.9 2 5Z" /><path d="M2.8 6.5v5h8.4v-5" /></>,
  sliders: <path d="M2 3.5h10M2 7h10M2 10.5h10M5 2.3v2.4M9 5.8v2.4M6 9.3v2.4" />,
  building: <><rect x="2.5" y="2" width="9" height="10" /><path d="M5 4.5h1M8 4.5h1M5 7h1M8 7h1M6.3 12V9.5h1.4V12" /></>,
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[rgb(71,69,67)]">
      {ICONS[name]}
    </svg>
  );
}

const row = "flex h-8 items-center gap-2.5 px-2 text-[15px] text-[rgb(26,25,25)]";

export function Sidebar() {
  return (
    <aside className="font-ramp sticky top-0 flex h-screen w-[216px] shrink-0 flex-col bg-[rgb(244,242,240)]">
      <div className="px-2 pb-2 pt-2">
        <div className="flex h-8 items-center gap-1 bg-[rgb(234,231,228)] p-0.5 text-[13px]">
          <span className="flex h-full flex-1 items-center justify-center gap-1.5 bg-white">
            <RampMark size={11} /> Ramp
          </span>
          <span className="flex h-full flex-1 items-center justify-center gap-1.5 text-[rgb(71,69,67)]">Stack</span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {GROUPS.map((group, gi) => (
          <ul key={gi} className={`px-2 py-2 ${gi > 0 ? "border-t border-[rgb(226,222,219)]" : ""}`}>
            {group.map((it) =>
              it.children ? (
                <li key={it.label} className="my-0.5 bg-[rgb(234,231,228)] pb-1">
                  <div className={row}>
                    <Icon name={it.icon} />
                    {it.label}
                  </div>
                  {it.children.map((c) =>
                    c.href ? (
                      <Link key={c.label} href={c.href} className={`mx-1 flex h-8 items-center px-6 text-[15px] ${c.active ? "bg-[rgb(250,249,248)] text-[rgb(26,25,25)]" : "text-[rgb(110,106,104)]"}`}>
                        {c.label}
                      </Link>
                    ) : (
                      <span key={c.label} className="mx-1 flex h-8 cursor-default items-center px-6 text-[15px] text-[rgb(110,106,104)]">
                        {c.label}
                      </span>
                    ),
                  )}
                </li>
              ) : (
                <li key={it.label} className={`${row} cursor-default`}>
                  <Icon name={it.icon} />
                  {it.label}
                </li>
              ),
            )}
          </ul>
        ))}
      </nav>
      <div className="flex h-12 items-center gap-2.5 border-t border-[rgb(226,222,219)] px-4 text-[15px]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="text-[rgb(71,69,67)]" aria-hidden>
          {[2, 7, 12].flatMap((x) => [2, 7, 12].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={x === 7 && y === 7 ? 1.4 : 0.9} />))}
        </svg>
        Ask Ramp
      </div>
    </aside>
  );
}
