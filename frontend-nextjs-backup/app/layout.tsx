import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Avatar",
  description: "Real-time voice conversation with AI avatar",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
