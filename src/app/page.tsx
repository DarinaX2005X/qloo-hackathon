import { preconnect, preload } from "react-dom";
import { Hero } from "@/components/landing/Hero";
import { Sections } from "@/components/landing/Sections";
import { LandingProvider } from "@/components/landing/LandingData";

export default function Home() {
  // start the landing data, the map style and the tiles before the page hydrates
  preload("/api/landing", { as: "fetch", crossOrigin: "anonymous" });
  preload("https://tiles.openfreemap.org/styles/positron", { as: "fetch", crossOrigin: "anonymous" });
  preconnect("https://tiles.openfreemap.org", { crossOrigin: "anonymous" });
  return (
    <main className="paper-noise bg-paper">
      <LandingProvider>
        <Hero />
        <Sections />
      </LandingProvider>
    </main>
  );
}
