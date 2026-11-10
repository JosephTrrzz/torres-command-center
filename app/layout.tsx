import { SessionHistoryGuard } from "../components/session-history-guard";
import type { Metadata } from "next";
import "./globals.css";
import "./ui-enhancements.css";
import "./design-foundation.css";
import "./private-office-production.css";
import "./editorial-workspace.css";
import "./liquid-glass.css";
import "./workspace-glass.css";

export const metadata: Metadata = {
  title: "Torres & Co. Command Center",
  description: "Technology agency operations and client health dashboard."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><SessionHistoryGuard />{children}</body></html>;
}
