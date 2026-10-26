import type { Metadata } from "next";
import "./globals.css";
import "./creative.css";
import "./labs.css";

export const metadata: Metadata = {
  title: "ZENITH AGENTIC REEL MAKER",
  description: "Three shots. Infinite stories. Record three moments. Direct five creative agents. Make something worth sharing.",
  applicationName: "Zenith Agentic Reel Maker",
  openGraph: { title: "ZENITH AGENTIC REEL MAKER", description: "Your AI film crew. Your story. Five deterministic creative tools. Seven real reel styles.", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
