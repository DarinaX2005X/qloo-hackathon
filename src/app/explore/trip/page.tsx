import type { Metadata } from "next";
import { TripScreen } from "@/components/explore/TripScreen";

export const metadata: Metadata = { title: "Trip | Homing" };

export default function Page() {
  return <TripScreen />;
}
