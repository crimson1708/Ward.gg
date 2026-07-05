import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ward",
  description: "League of Legends esports schedules, results, and stats",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* The header lives in the layout, so it renders on every page. */}
        <header className="site-header">
          <div className="inner">
            <a href="/" className="brand">
              Ward
            </a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
