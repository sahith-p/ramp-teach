/** The vendor's own site (Halcyon Staffing client portal): separate look from Ramp Teach. */
export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>;
}
