import type { Metadata } from "next";
import { GenerateStudio } from "@/components/app/studio/Studio";

export const metadata: Metadata = { title: "Editing · Unfold" };

export default function NewEditPage() {
  return <GenerateStudio />;
}
