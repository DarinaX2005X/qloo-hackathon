import type { Metadata, Viewport } from "next";
import { Geologica } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const geologica = Geologica({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geologica",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Homing | Find your part of any city",
  description:
    "Tell Homing a few things you love. It maps where people with your taste gather in a city, which neighborhood fits you and what to do there.",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Homing | Find your part of any city",
    description: "A taste map of any city, built from the things you love with Qloo's taste graph.",
  },
};

export const viewport: Viewport = { themeColor: "#f6f2ea", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geologica.variable}>
      <body>{children}</body>
    </html>
  );
}
