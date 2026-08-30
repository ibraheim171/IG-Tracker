import type { Metadata } from "next";
import { Cairo, IBM_Plex_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic"], variable: "--font-heading" });
const body = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], variable: "--font-body", weight: ["400", "500", "600", "700"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "600", "700"] });

const themeScript = `(() => {
  try {
    const match = document.cookie.match(/(?:^|; )aqsana_theme=([^;]+)/);
    const saved = match ? decodeURIComponent(match[1]) : "system";
    document.documentElement.dataset.theme = ["light", "dark", "system"].includes(saved) ? saved : "system";
  } catch {
    document.documentElement.dataset.theme = "system";
  }
})();`;

export const metadata: Metadata = { title: "سنفتح أقصانا" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script id="theme-bootstrap" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${cairo.variable} ${body.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
