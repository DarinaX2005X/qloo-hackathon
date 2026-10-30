import type { Metadata } from "next";
import { MapScreen } from "@/components/explore/MapScreen";

export const metadata: Metadata = { title: "Explore | Homing" };

export default function ExplorePage() {
  return <MapScreen />;
}
