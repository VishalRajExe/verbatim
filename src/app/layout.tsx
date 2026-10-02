import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-screen antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
