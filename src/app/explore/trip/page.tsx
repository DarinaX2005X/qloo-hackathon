import type { Metadata } from "next";
import { TripScreen } from "@/components/explore/TripScreen";

export const metadata: Metadata = { title: "Try the neighborhood | Homing" };

export default function Page() {
  return <TripScreen />;
}
