import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Squad Reel Studio",
  description: "Turn three real shots into a festival-ready reel.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
