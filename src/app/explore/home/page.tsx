import type { Metadata } from "next";
import { HomeScreen } from "@/components/screens/HomeScreen";

export const metadata: Metadata = { title: "Feels like home | Homing" };

export default function Page() {
  return <HomeScreen />;
}
