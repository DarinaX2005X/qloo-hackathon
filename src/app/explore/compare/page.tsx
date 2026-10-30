import type { Metadata } from "next";
import { CompareScreen } from "@/components/explore/CompareScreen";

export const metadata: Metadata = { title: "Compare | Homing" };

export default function Page() {
  return <CompareScreen />;
}
