import type { Metadata } from "next";
import { WhyScreen } from "@/components/screens/WhyScreen";

export const metadata: Metadata = { title: "Why this area | Homing" };

export default function Page() {
  return <WhyScreen />;
}
