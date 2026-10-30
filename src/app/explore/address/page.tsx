import type { Metadata } from "next";
import { AddressScreen } from "@/components/screens/AddressScreen";

export const metadata: Metadata = { title: "Check an address | Homing" };

export default function Page() {
  return <AddressScreen />;
}
