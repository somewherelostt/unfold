"use client";
import { useState, type FormEvent } from "react";
import { actions } from "@/lib/client/store";
import { Button } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/icons";
import type { PromptSubmit } from "@/components/ui/PromptShell";

const EXAMPLES = [
  { label: "Keep it natural", prompt: "Keep the natural pacing and original audio. Use cutaways only when they add useful context." },
  { label: "Clean captions", prompt: "Add clean, readable captions that follow the speech. Keep the edit focused on the story." },
  { label: "Tighter pacing", prompt: "Tighten pauses while preserving complete thoughts and the natural beginning and ending." },
];
const STYLES = ["Auto", "Pop", "Clean", "Chaos", "Storytime"];

export function EditBrief({ defaultText, defaultStyle, defaultAspect, disabled, busy, hasClip, onSubmit }: { defaultText: string; defaultStyle: string; defaultAspect: string; disabled: boolean; busy: boolean; hasClip: boolean; onSubmit: (value: PromptSubmit) => void | Promise<void> }) {
  const [text, setText] = useState(defaultText);
  const [style, setStyle] = useState(STYLES.includes(defaultStyle) ? defaultStyle : "Auto");
  const [aspect, setAspect] = useState(["9:16", "1:1", "16:9"].includes(defaultAspect) ? defaultAspect : "9:16");
  const [error, setError] = useState("");
  const [lastText, setLastText] = useState(defaultText);
  if (lastText !== defaultText) { setLastText(defaultText); setText(defaultText); }
  function update(value: string) { setText(value); actions.setPrompt(value); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled) return;
    setError("");
    try { await onSubmit({ prompt: text.trim(), style, aspect, file: null }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't start this edit. Please try again."); }
  }
  return <form onSubmit={(event) => void submit(event)} className="uf-edit-brief">
    <div>
      <label htmlFor="edit-brief" className="mb-2 block text-[13px] font-medium text-text-2">Direction <span className="font-normal text-text-3">· optional</span></label>
      <textarea id="edit-brief" rows={3} value={text} onChange={(event) => update(event.target.value)} placeholder="Keep the best moments, preserve my voice, add clean captions…" className="uf-field w-full resize-y" />
      <p className="mt-2 text-[12px] leading-5 text-text-3">Leave this blank for an edit shaped around your footage.</p>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Brief examples">{EXAMPLES.map((example) => <button type="button" key={example.label} className="uf-example-chip" onClick={() => update(example.prompt)}>{example.label}</button>)}</div>
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-2 text-[12px] text-text-2"><span className="block">Caption direction</span><select className="uf-field w-full" value={style} onChange={(event) => setStyle(event.target.value)}>{STYLES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="space-y-2 text-[12px] text-text-2"><span className="block">Output format</span><select className="uf-field w-full" value={aspect} onChange={(event) => setAspect(event.target.value)}><option value="9:16">9:16 · Vertical</option><option value="16:9">16:9 · Wide</option><option value="1:1">1:1 · Square</option></select></label>
    </div>
    <div className="border-t border-hairline pt-4">
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={disabled}>{busy ? "Preparing your footage…" : "Create edit"}<IconArrowRight size={16} /></Button>
      <p className="mt-2 text-center text-[12px] leading-5 text-text-3">{!hasClip ? "Upload your main clip to begin." : "Music, effects and cutaways follow what your footage needs."}</p>
    </div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </form>;
}
