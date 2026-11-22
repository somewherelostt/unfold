import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeScreen } from "@/components/app/home/HomeScreen";

export const metadata: Metadata = { title: "New edit · Unfold" };

export default function AppHome() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <HomeScreen />
    </Suspense>
  );
}
