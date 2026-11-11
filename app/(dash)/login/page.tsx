import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in · Ramp Teach" };

function Field({ name, type, label }: { name: string; type: string; label: string }) {
  return (
    <label className="block border border-[#8a8a8a] px-3 pb-2 pt-1.5 focus-within:border-ink">
      <span className="block text-[11px] text-ink-muted">
        {label} <span aria-hidden>*</span>
      </span>
      <input name={name} type={type} autoComplete="off" className="w-full bg-transparent text-[15px] outline-none" />
    </label>
  );
}

export default async function DashLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="relative min-h-[calc(100vh-44px)] bg-white px-6">
      <div className="absolute left-14 top-9 text-[22px] font-medium tracking-tight">ramp teach</div>
      <div className="flex min-h-[calc(100vh-44px)] items-center justify-center">
        <form action="/api/dash/login" method="post" className="w-full max-w-[576px]">
          <h1 className="mb-5 text-[28px] font-normal tracking-tight">Welcome to Ramp Teach</h1>
          {error && <p className="mb-3 text-sm text-fail">Enter your email and password.</p>}
          <div className="space-y-3">
            <Field name="email" type="email" label="Email address" />
            <Field name="password" type="password" label="Password" />
          </div>
          <button type="submit" className="mt-4 w-full bg-accent py-4 text-[15px] text-ink hover:brightness-95">
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
