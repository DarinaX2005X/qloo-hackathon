import type { Metadata } from "next";
import { ExploreApp } from "@/components/explore/ExploreApp";

export const metadata: Metadata = { title: "Explore | Homing" };

export default function ExplorePage() {
  return <ExploreApp />;
}
