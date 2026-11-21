import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorScreen } from "@/components/app/editor/EditorScreen";

export const metadata: Metadata = { title: "Editor · Unfold" };

// Plans live client-side (and behind /api/plan/:id), so the editor resolves the id in the browser.
export default function EditPage() {
  return (
    <Suspense fallback={<div className="flex-1 bg-bg" />}>
      <EditorScreen />
    </Suspense>
  );
}
