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
  title: "Homing | Where to start looking in a new city",
  description:
    "Moving to a new city? Bring the places and things you love, or a neighborhood you loved. Homing suggests areas to start looking for a home and the real places to check there.",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Homing | Where to start looking in a new city",
    description: "A short list of areas in a new city, picked from what you love with Qloo's cultural data, with places you can check in person.",
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
