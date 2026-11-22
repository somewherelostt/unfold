"use client";
/** White "Export ⌘E" with a popover (resolution, captions, size estimate) and a progress toast. */
import type { EditPlan } from "@unfold/core";
import { useEffect, useRef, useState } from "react";
import { exportVideo } from "@/lib/client/api";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Popover } from "@/components/ui/Popover";
import { Segmented } from "@/components/ui/Segmented";
import { Toast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { IconCheck, IconDownload, IconExport } from "@/components/ui/icons";
import { Row } from "./panels/CaptionsPanel";

type State = null | { progress: number } | { url: string } | { error: string };

export function ExportButton({ serverId, plan, disabled }: { serverId?: string; plan?: EditPlan; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<"720p" | "1080p">("1080p");
  const [burn, setBurn] = useState(true);
  const [state, setState] = useState<State>(null);
  const rendering = !!state && "progress" in state;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e" && !disabled && !rendering) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [disabled, rendering]);

  async function run() {
    if (!serverId || !plan || rendering) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setOpen(false);
    setState({ progress: 0 });
    try {
      for await (const ev of exportVideo(serverId, { editPlan: plan, resolution: res, burnCaptions: burn }, ctrl.signal)) {
        if (ctrl.signal.aborted) return;
        if (ev.type === "progress") setState({ progress: ev.progress });
        else if (ev.type === "ready") setState({ url: ev.url });
        else if (ev.type === "error") throw new Error(ev.message);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setState({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }

  const mbps = res === "1080p" ? 8 : 4;
  const sizeMb = plan ? Math.max(1, Math.round((plan.durationSec * mbps) / 8 + plan.durationSec * 0.02)) : 0;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        className="w-[280px] p-3"
        trigger={() => (
          <Button variant="primary" size="sm" disabled={disabled || !serverId || rendering} onClick={() => setOpen((o) => !o)} className="h-8">
            <IconExport size={14} />
            {rendering ? <span className="tabular font-mono">{Math.round((state as { progress: number }).progress * 100)}%</span> : "Export"}
            <Kbd tone="dark">⌘E</Kbd>
          </Button>
        )}
      >
        {() => (
          <div className="space-y-3">
            <div className="text-[13px] font-medium">Export video</div>
            <Row label="Resolution">
              <Segmented mono className="w-[132px]" options={[{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }]} value={res} onChange={(v) => setRes(v as "720p" | "1080p")} />
            </Row>
            <Row label="Burn in captions">
              <Toggle label="Burn in captions" checked={burn} onChange={setBurn} />
            </Row>
            <div className="flex items-center justify-between text-[12px] text-text-3">
              <span>MP4 · {plan?.aspect ?? "9:16"}</span>
              <span className="tabular font-mono">≈ {sizeMb} MB</span>
            </div>
            <Button variant="primary" className="w-full" onClick={() => void run()}>
              Export MP4
            </Button>
          </div>
        )}
      </Popover>

      {state && "progress" in state && (
        <Toast icon={<span className="size-2 animate-pulse rounded-full bg-agent" />} actions={<Button size="sm" variant="ghost" onClick={() => { controller.current?.abort(); setState(null); }}>Cancel</Button>}>
          Rendering your edit · <span className="tabular font-mono">{Math.round(state.progress * 100)}%</span>
        </Toast>
      )}
      {state && "url" in state && (
        <Toast
          icon={<IconCheck size={14} className="text-success" />}
          onClose={() => setState(null)}
          actions={
            <>
              <a href={state.url} target="_blank" rel="noreferrer" className="h-7 rounded-full px-3 text-[12px] leading-7 text-text-1 hover:bg-surface-3">
                Open
              </a>
              <a href={state.url} download className="flex h-7 items-center gap-1 rounded-full bg-primary-btn px-3 text-[12px] font-medium text-primary-btn-ink">
                <IconDownload size={13} /> Download
              </a>
            </>
          }
        >
          Export ready
        </Toast>
      )}
      {state && "error" in state && (
        <Toast
          icon={<span className="size-2 rounded-full bg-danger" />}
          onClose={() => setState(null)}
          actions={
            <button type="button" onClick={() => void run()} className="h-7 rounded-full px-3 text-[12px] text-text-1 hover:bg-surface-3">
              Retry
            </button>
          }
        >
          Export failed · {state.error}
        </Toast>
      )}
    </>
  );
}
