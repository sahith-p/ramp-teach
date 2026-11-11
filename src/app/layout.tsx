import type { Metadata } from "next";
import "./globals.css";
import { DemoBanner } from "@/components/ui/DemoBanner";

export const metadata: Metadata = {
  title: "Ramp Teach",
  description: "Unofficial demo inspired by Ramp's design. Teach an agent to check a service invoice.",
};

/** Root shell only. Each area brings its own chrome: (site), (vendor) portal, (dash) bill pay. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-surface text-ink">
        <div className="flex-1">{children}</div>
        <DemoBanner />
      </body>
    </html>
  );
}
