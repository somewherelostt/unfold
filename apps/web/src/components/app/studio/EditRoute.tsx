"use client";
import { useParams } from "next/navigation";
import { EditStudio } from "./Studio";

/** Reads the plan id in the browser and remounts the editor per edit (switching versions resets UI state). */
export function EditRoute() {
  const { id } = useParams<{ id: string }>();
  return <EditStudio key={id} id={id} />;
}
