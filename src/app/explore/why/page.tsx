import type { Metadata } from "next";
import { WhyScreen } from "@/components/screens/WhyScreen";

export const metadata: Metadata = { title: "What decides | Homing" };

export default function Page() {
  return <WhyScreen />;
}
