import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageTitle, PortalHeader } from "@/components/fixtures/FixtureChrome";
import { DEMO_PASSWORD, DEMO_USERNAME } from "@/components/fixtures/session";
import { firstParam } from "@/components/fixtures/portal-data";

export const metadata = { title: "Sign in — Fixture vendor portal" };

export default async function PortalLogin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const error = firstParam((await searchParams).error) === "1";
  const input = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink";
  return (
    <div>
      <PortalHeader signedIn={false} />
      <div className="mx-auto max-w-md">
        <PageTitle sub="Client access to invoices and approved timecards.">Sign in</PageTitle>
        <Card>
          {error && (
            <p
              role="alert"
              data-testid="login-error"
              className="mb-4 rounded-lg border border-fail/30 bg-fail/5 px-3 py-2 text-sm text-fail"
            >
              Incorrect username or password. Use the demo credentials below.
            </p>
          )}
          <form action="/api/portal/login" method="post" className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Username</span>
              <input name="username" type="text" autoComplete="username" required className={input} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Password</span>
              <input name="password" type="password" autoComplete="current-password" required className={input} />
            </label>
            <Button type="submit" variant="primary">
              Sign in
            </Button>
          </form>
        </Card>
        <section
          aria-label="Demo credentials"
          className="mt-6 rounded-[var(--radius-card)] border border-line bg-wash p-4 text-sm"
        >
          <h2 className="mb-2 font-medium">Demo credentials (fixture only)</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-muted">Username</dt>
            <dd>
              <code data-testid="demo-username">{DEMO_USERNAME}</code>
            </dd>
            <dt className="text-ink-muted">Password</dt>
            <dd>
              <code data-testid="demo-password">{DEMO_PASSWORD}</code>
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
