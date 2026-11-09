import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, ModeBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

type ModeLine = { badge: ReactNode; text: string };
type Stage = {
  n: string;
  name: string;
  title: string;
  description: string;
  modes: ModeLine[];
  links: { href: string; label: string }[];
  span: string;
};

const HUMAN = <Badge>Human</Badge>;

const STAGES: Stage[] = [
  {
    n: "01",
    name: "Record",
    title: "Show it once",
    description: "An AP reviewer verifies a past invoice in the vendor portal while the Chrome recorder captures clicks and narration.",
    modes: [
      { badge: HUMAN, text: "A person does the work; the extension only records it (passwords redacted)." },
      { badge: <Badge>Sample file</Badge>, text: "Offline: the committed data/recording.sample.json stands in." },
    ],
    links: [{ href: "/portal/login", label: "Vendor portal (fixture)" }],
    span: "md:col-span-2",
  },
  {
    n: "02",
    name: "Learn",
    title: "Distill the rules",
    description: "The recording becomes rules/workflow_spec.json (proof sources, rules, open questions); past corrections become evals.",
    modes: [
      { badge: <ModeBadge mode="real" />, text: "Claude distills the recording when credentials are present." },
      { badge: <ModeBadge mode="deterministic" />, text: "Otherwise a deterministic distiller, labelled as such." },
    ],
    links: [],
    span: "md:col-span-2",
  },
  {
    n: "03",
    name: "Verify",
    title: "Check the new invoice",
    description: "Six deterministic checks run on HSG-1011; the browser agent reads approved timecards off the portal for the hours check.",
    modes: [
      { badge: <ModeBadge mode="deterministic" />, text: "Calc is always deterministic. No LLM in the math." },
      { badge: <ModeBadge mode="real" />, text: "Claude drives the local browser to gather timecard evidence." },
      { badge: <ModeBadge mode="scripted" />, text: "Offline: fixed Playwright steps collect the same pages." },
    ],
    links: [{ href: "/portal/login", label: "Timecard portal" }],
    span: "md:col-span-2",
  },
  {
    n: "04",
    name: "Receipt",
    title: "Show the work",
    description: "Every check becomes a row: expected, actual, result, and an evidence pointer you can open. It recommends approve, dispute, or review.",
    modes: [
      { badge: <ModeBadge mode="real" />, text: "Claude synthesizes the receipt from calc + evidence." },
      { badge: <ModeBadge mode="mock" />, text: "Offline: a deterministic mapper writes the same shape." },
    ],
    links: [
      { href: "/receipts", label: "Receipts" },
      { href: "/receipts/sample", label: "Sample receipt" },
    ],
    span: "md:col-span-3",
  },
  {
    n: "05",
    name: "Decide + attach",
    title: "A human decides",
    description: "A reviewer approves or disputes on the receipt. Only then is the receipt attached to the bill in the inbox.",
    modes: [{ badge: HUMAN, text: "Human only. The agent never approves, pays, submits, or attaches." }],
    links: [
      { href: "/receipts", label: "Review receipts" },
      { href: "/bills", label: "Bill inbox (fixture)" },
    ],
    span: "md:col-span-3",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <div className="mb-2 text-xs uppercase tracking-wider text-ink-faint">Service-invoice verification</div>
        <h1 className="font-display text-4xl leading-tight tracking-tight">Teach an agent to check an invoice the way you do.</h1>
        <p className="mt-4 text-base text-ink-muted">
          Record a reviewer once, learn the rules, verify a new Halcyon Staffing Group invoice with evidence for every check, and hand
          a receipt to a human who decides. Every output says how it was produced.
        </p>
      </header>

      <ol className="grid gap-6 md:grid-cols-6">
        {STAGES.map((s) => (
          <li key={s.n} className={s.span}>
            <Card className="flex h-full flex-col">
              <div className="mb-1 text-xs uppercase tracking-wider text-ink-faint">
                <span className="tabular">{s.n}</span> · {s.name}
              </div>
              <h2 className="font-display text-2xl tracking-tight">{s.title}</h2>
              <p className="mt-2 text-sm text-ink-muted">{s.description}</p>
              <ul className="mt-5 space-y-2.5 border-t border-line pt-4">
                {s.modes.map((m, i) => (
                  <li key={i} className="flex flex-col items-start gap-1 text-xs text-ink-muted">
                    {m.badge}
                    <span>{m.text}</span>
                  </li>
                ))}
              </ul>
              {s.links.length > 0 && (
                <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-5 text-sm">
                  {s.links.map((l) => (
                    <Link key={l.href} href={l.href} className="font-medium underline decoration-line underline-offset-4 hover:decoration-ink">
                      {l.label} →
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ol>

      <Card eyebrow="Run it" title="One command, labelled honestly">
        <p className="text-sm text-ink-muted">
          <code className="font-mono text-xs text-ink">npm run demo</code> runs learn → verify → receipt end to end against the local
          fixture app. With no API credentials it runs in labelled offline modes (deterministic, scripted, mock) — never presented as AI.
        </p>
      </Card>
    </div>
  );
}
