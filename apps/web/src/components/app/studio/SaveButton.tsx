"use client";
import { useState } from "react";
import type { EditPlan } from "@unfold/core";
import { actions, type PlanEntry } from "@/lib/client/store";
import { planKey } from "@/lib/client/plan-key";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";

export function SaveButton({ id, entry, plan }: { id: string; entry: PlanEntry; plan: EditPlan }) {
  const [dismissed, dismiss] = useState<PlanEntry["save"]>();
  const dirty = planKey(plan) !== planKey(entry.savedPlan ?? entry.base);
  const saving = entry.save?.status === "saving";
  const error = entry.save && ["error", "conflict"].includes(entry.save.status) && entry.save !== dismissed;
  return <>
    <Button size="sm" variant={dirty ? "secondary" : "ghost"} disabled={saving || !dirty} title={dirty ? "Save your current edit to your account" : "This edit matches the saved version"} onClick={() => void actions.savePlan(id)}>
      {saving ? "Saving…" : dirty ? "Save" : "Saved"}
    </Button>
    {error && <Toast onClose={() => dismiss(entry.save)} actions={<div className="flex gap-1">
      {entry.save?.status === "conflict" && <Button size="sm" variant="ghost" onClick={() => void actions.reloadSavedPlan(id)}>Reload saved edit</Button>}
      <Button size="sm" variant="ghost" onClick={() => void actions.savePlan(id)}>Retry save</Button>
    </div>}>{entry.save?.message ?? "Couldn't save this edit. Your local draft is still here."}{entry.save?.status === "conflict" && " Your local changes remain available through Undo after reloading."}</Toast>}
  </>;
}
