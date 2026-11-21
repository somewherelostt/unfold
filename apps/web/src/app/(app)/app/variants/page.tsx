import type { Metadata } from "next";
import { VariantsScreen } from "@/components/app/variants/VariantsScreen";

export const metadata: Metadata = { title: "9 edits · Unfold" };

export default function VariantsPage() {
  return <VariantsScreen />;
}
