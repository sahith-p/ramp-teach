import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in · Ramp Teach" };

export default async function DashLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-[calc(100vh-44px)] items-center justify-center bg-[#fbfbf9] px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center text-[22px] font-semibold tracking-tight">Ramp Teach</div>
        <form action="/api/dash/login" method="post" className="rounded-2xl border border-line bg-white p-7 shadow-sm">
          <h1 className="mb-5 text-lg font-semibold">Sign in</h1>
          {error && <p className="mb-4 text-sm text-fail">Enter your email and password.</p>}
          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block text-ink-muted">Work email</span>
            <input name="email" type="email" autoComplete="off" className="w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-ink" />
          </label>
          <label className="mb-6 block text-sm">
            <span className="mb-1.5 block text-ink-muted">Password</span>
            <input name="password" type="password" className="w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-ink" />
          </label>
          <button type="submit" className="w-full rounded-lg bg-[#1f1f1f] py-2.5 text-sm font-medium text-white hover:bg-black">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
