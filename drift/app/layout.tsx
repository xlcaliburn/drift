import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DRIFT",
  description: "A brutal space-opera TTRPG, run by an engine + narrator.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
