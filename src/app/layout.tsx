import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600"],
  display: "swap",
});

const sourceSerif4 = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-doc",
  weight: ["400", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Verbatim — Legal Contract Analysis",
  description: "Deterministic legal contract analysis backed by verified quotes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${publicSans.variable} ${sourceSerif4.variable}`}>
      <body className="min-h-screen antialiased bg-paper text-ink font-sans">
        {children}
      </body>
    </html>
  );
}
