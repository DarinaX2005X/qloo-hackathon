import type { Metadata } from "next";
import { AssistantScreen } from "@/components/explore/AssistantScreen";

export const metadata: Metadata = { title: "Ask Homing" };

export default function Page() {
  return <AssistantScreen />;
}
