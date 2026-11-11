import type { Metadata } from "next";
import { RampLogo } from "@/components/dash/RampLogo";

export const metadata: Metadata = { title: "Ramp Login Page" };

function Field({ name, type, label }: { name: string; type: string; label: string }) {
  return (
    <label className="block border border-[rgb(110,106,104)] px-3 pb-2 pt-2 focus-within:border-[rgb(26,25,25)]">
      <span className="block text-[12px] leading-4 text-[rgb(71,69,67)]">
        {label} <span aria-hidden>*</span>
      </span>
      <input name={name} type={type} autoComplete="off" className="mt-0.5 w-full bg-transparent text-[16px] outline-none" />
    </label>
  );
}

export default async function DashLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="font-ramp relative min-h-screen bg-white px-6">
      <div className="absolute left-14 top-9">
        <RampLogo height={24} />
      </div>
      <div className="flex min-h-screen items-center justify-center">
        <form action="/api/dash/login" method="post" className="w-full max-w-[576px]">
          <h1 className="mb-5 text-[28px] font-normal tracking-[-0.01em]">Welcome to Ramp</h1>
          {error && <p className="mb-3 text-sm text-fail">Enter your email and password.</p>}
          <div className="space-y-4">
            <Field name="email" type="email" label="Email address" />
            <Field name="password" type="password" label="Password" />
          </div>
          <button type="submit" className="mt-4 h-14 w-full bg-[rgb(228,242,34)] text-[16px] font-normal text-[rgb(26,25,25)] hover:brightness-95">
            Continue
          </button>
          <p className="mt-3 text-[16px] text-[rgb(71,69,67)]">
            Looking to get started with Ramp for your business? <span className="underline underline-offset-4">Sign up ↗</span>
          </p>
        </form>
      </div>
    </div>
  );
}
