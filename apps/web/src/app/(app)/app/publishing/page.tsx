import type { Metadata } from "next";
import { PublishingWorkspace } from "@/components/publishing/PublishingWorkspace";
export const metadata: Metadata = { title: "Publishing · Unfold" };
export default function PublishingPage() { return <PublishingWorkspace />; }
