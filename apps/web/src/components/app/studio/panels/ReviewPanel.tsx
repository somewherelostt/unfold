"use client";
import { useEffect, useState } from "react";
import { checkPlanQuality, fingerprintPlan } from "@unfold/video";
import { actions, useStore } from "@/lib/client/store";
import { planKey } from "@/lib/client/plan-key";
import { reviewMatches } from "@/lib/client/export-plan";
import { Button } from "@/components/ui/Button";
import type { PanelProps } from "./types";

export function ReviewPanel({ id, plan }: PanelProps) {
  const entry = useStore((s) => s.plans[id]);
  const record = useStore((s) => s.reviews[id]);
  const [fingerprint, setFingerprint] = useState("");
  useEffect(() => {
    let active = true;
    void fingerprintPlan(plan).then((value) => { if (active) setFingerprint(value); }, () => { if (active) setFingerprint(""); });
    return () => { active = false; };
  }, [plan]);
  const analysis = useStore((s) => s.analyses[plan.source.videoId] ?? (s.project.analysis?.videoId === plan.source.videoId ? s.project.analysis : undefined));
  const checks = checkPlanQuality(plan, analysis);
  const dirty = !!entry && planKey(plan) !== planKey(entry.savedPlan ?? entry.base);
  const pending = entry?.chat.some((m) => m.role === "agent" && m.pending);
  const issues = [...checks.errors, ...checks.warnings];
  const currentReview = reviewMatches(record, fingerprint, dirty, entry?.save?.status === "conflict");
  const report = currentReview ? record?.review : undefined;
  return <div className="uf-tool-content space-y-5 px-4 pb-4 text-[12px] leading-5">
    <section aria-label="Timeline review" className="space-y-2">
      <h3 className="text-[13px] font-medium text-text-1">Timeline structure</h3>
      <p role="status" className={checks.passed ? "text-success" : "text-danger"}>{checks.passed ? "Structure checks passed" : "This edit needs attention"}</p>
      <p className="text-text-3">Checks for timing and plan consistency. Preview the edit to judge the story, wording and creative choices.</p>
      <ul className="space-y-1 text-text-3">{checks.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      {checks.errors.map((error) => <p key={error} className="rounded-md bg-surface-2 p-2 text-danger">{error}</p>)}
      {checks.warnings.map((warning) => <p key={warning} className="rounded-md bg-surface-2 p-2 text-text-2">{warning}</p>)}
      {issues.length > 0 && <>
        <Button size="sm" variant="secondary" disabled={dirty || pending} onClick={() => void actions.remix(id, `Revise this edit to address these checks while preserving narration and supplied footage:\n${issues.join("\n")}`)}>Ask agent to revise</Button>
        {dirty && <p className="text-[12px] text-text-3">Save this edit first so the agent can use your latest cutaways and settings.</p>}
      </>}
    </section>
    <section aria-label="Rendered video review" className="space-y-2">
      <h3 className="text-[13px] font-medium text-text-1">Export inspection</h3>
      {report ? <>
        <p role="status" className={report.passed ? "text-success" : "text-danger"}>{report.passed ? "Export inspected" : "Export needs attention"}{report.warnings.length > 0 ? ` · ${report.warnings.length} ${report.warnings.length === 1 ? "item" : "items"} to review` : ""}</p>
        <p className="text-text-3">Measured picture and audio checks. Watch and listen to confirm caption accuracy and the final result.</p>
        {report.errors.map((error) => <p key={error} className="rounded-md bg-surface-2 p-2 text-danger">{error}</p>)}
        {report.warnings.map((warning) => <p key={warning} className="rounded-md bg-surface-2 p-2 text-text-2">{warning}</p>)}
        <details><summary className="cursor-pointer text-text-2">What was checked</summary><ul className="mt-2 space-y-1 text-text-3">{report.checks.map((check) => <li key={check}>{check}</li>)}{Object.values(report.coverage).map((coverage) => <li key={coverage}>{coverage}</li>)}</ul></details>
        {record?.contactSheetUrl && <a href={record.contactSheetUrl} target="_blank" rel="noreferrer" className="block text-[12px] text-text-2 hover:text-text-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={record.contactSheetUrl} alt="Frames sampled from this export" className="w-full rounded-md" />Open inspected frames
        </a>}
        <div className="flex flex-wrap gap-3 text-text-2"><a href={record?.url} target="_blank" rel="noreferrer" className="underline">Watch this export</a>{record?.reviewUrl && <a href={record.reviewUrl} target="_blank" rel="noreferrer" className="underline">Review details</a>}</div>
        {(report.errors.length > 0 || report.warnings.length > 0) && <Button size="sm" variant="secondary" disabled={pending} onClick={() => void actions.remix(id, `Review these measured export findings and revise only where they warrant an editorial change. Preserve the primary narration and supplied footage:\n${[...report.errors, ...report.warnings].join("\n")}`)}>Ask agent to revise</Button>}
      </> : <p className="text-text-3">{record?.reviewError ? `The MP4 is ready, but its rendered review could not finish: ${record.reviewError}. Export again to retry the review.` : record ? "This preview or its saved revision differs from the inspected export. Save your current edit and export it again for a matching review." : "No rendered review is attached to this edit yet. Timeline checks do not verify the exported picture or sound."}</p>}
    </section>
  </div>;
}
