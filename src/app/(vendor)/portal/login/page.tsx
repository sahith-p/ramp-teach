import { PageTitle, PortalShell } from "@/components/fixtures/FixtureChrome";
import { DEMO_PASSWORD, DEMO_USERNAME } from "@/components/fixtures/session";
import { firstParam } from "@/components/fixtures/portal-data";

export const metadata = { title: "Sign in · Halcyon Staffing client portal" };

export default async function PortalLogin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const error = firstParam((await searchParams).error) === "1";
  const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-[#123c4a]";
  return (
    <PortalShell signedIn={false}>
      <div className="mx-auto mt-6 max-w-sm">
        <PageTitle>Sign in</PageTitle>
        {error && (
          <p role="alert" data-testid="login-error" className="mb-4 rounded-md border border-fail/30 bg-fail/5 px-3 py-2 text-sm text-fail">
            Wrong username or password.
          </p>
        )}
        <form action="/api/portal/login" method="post" className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>Username</span>
            <input name="username" type="text" autoComplete="username" required className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required className={input} />
          </label>
          <button type="submit" className="mt-2 rounded-md bg-[#123c4a] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0d2e39]">
            Sign in
          </button>
        </form>
        <p aria-label="Demo credentials" className="mt-6 text-sm text-ink-muted">
          Demo login: <code data-testid="demo-username" className="text-ink">{DEMO_USERNAME}</code> /{" "}
          <code data-testid="demo-password" className="text-ink">{DEMO_PASSWORD}</code>
        </p>
      </div>
    </PortalShell>
  );
}
