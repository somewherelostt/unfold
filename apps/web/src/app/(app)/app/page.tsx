import type { Metadata } from "next";
import { HomeScreen } from "@/components/app/home/HomeScreen";

export const metadata: Metadata = { title: "New clip · Unfold" };

export default function AppHome() {
  return <HomeScreen />;
}
