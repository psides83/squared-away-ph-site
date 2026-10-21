import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Squared Away | Barn Office",
    template: "%s | Squared Away",
  },
  description:
    "The private barn office for Squared Away Performance Horses in Granbury, Texas.",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Squared Away",
    statusBarStyle: "default",
  },
};
export const viewport: Viewport = {
  themeColor: "#30291f",
  width: "device-width",
  initialScale: 1,
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
