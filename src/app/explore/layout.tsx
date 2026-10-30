import type { Metadata } from "next";
import { ExploreProvider } from "@/components/explore/store";
import { FeaturesProvider } from "@/components/screens/features";
import { AppShell } from "@/components/explore/AppShell";

export const metadata: Metadata = { title: "Explore | Homing" };

/** One store, one map: every explore screen renders its panels inside this shell, so the terrain never remounts. */
export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return (
    <ExploreProvider>
      <FeaturesProvider>
        <AppShell>{children}</AppShell>
      </FeaturesProvider>
    </ExploreProvider>
  );
}
