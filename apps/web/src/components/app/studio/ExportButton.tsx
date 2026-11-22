"use client";
/** White "Export ⌘E" with a popover (resolution, captions, size estimate) and a progress toast. */
import type { EditPlan } from "@unfold/core";
import { fingerprintPlan } from "@unfold/video";
import { useEffect, useRef, useState } from "react";
import { cancelJob, DURABLE_JOBS, enqueueExport, exportVideo, getExportResult, watchJob, type ExportOptions } from "@/lib/client/api";
import { actions, getState, useStore } from "@/lib/client/store";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Popover } from "@/components/ui/Popover";
import { Segmented } from "@/components/ui/Segmented";
import { Toast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { IconCheck, IconDownload, IconExport } from "@/components/ui/icons";
import { Row } from "./panels/CaptionsPanel";

type State = null | { progress: number; stage?: string } | { url: string } | { error: string; jobId?: string; retryOriginal?: boolean };

export function ExportButton({ id, serverId, plan, disabled }: { id?: string; serverId?: string; plan?: EditPlan; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<"720p" | "1080p">("1080p");
  const [burn, setBurn] = useState(true);
  const [state, setState] = useState<State>(null);
  const [reconnectAttempt, reconnect] = useState(0);
  const jobId = useStore((s) => id ? s.exportJobs[id]?.jobId : undefined);
  const rendering = !!jobId || (!!state && "progress" in state);
  const reconnectable = !!jobId && (!state || "error" in state);
  const controller = useRef<AbortController | null>(null);
  const pendingCancel = useRef(false);
  const pendingEnqueue = useRef<{ serverId: string; opts: ExportOptions; key: string; submittedFingerprint: string; requestedSettings: { resolution: "720p" | "1080p"; burnCaptions: boolean } } | null>(null);
  useEffect(() => () => controller.current?.abort(), [serverId]);

  useEffect(() => {
    if (!id || !jobId) return;
    const association = getState().exportJobs[id];
    if (!association || association.jobId !== jobId) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    void (async () => {
      try {
        for await (const job of watchJob(jobId, association.cursor, ctrl.signal)) {
          ctrl.signal.throwIfAborted();
          actions.trackExportJob(id, { ...association, cursor: job.revision });
          if (job.state === "succeeded") {
            const result = await getExportResult(jobId, ctrl.signal);
            ctrl.signal.throwIfAborted();
            actions.recordExport(id, { ...result, submittedFingerprint: association.submittedFingerprint, requestedSettings: association.requestedSettings });
            setState({ url: result.url }); actions.clearExportJob(id, jobId); return;
          }
          if (job.state === "failed" || job.state === "cancelled") {
            pendingEnqueue.current = null;
            setState({ error: job.state === "cancelled" ? "Export cancelled." : job.error?.message ?? "The export failed." });
            actions.clearExportJob(id, jobId); return;
          }
          setState({ progress: Math.max(0, Math.min(1, job.progress.fraction)), stage: job.cancelRequestedAt ? "Cancelling export" : job.progress.stage || "Export queued" });
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setState({ error: e instanceof Error ? e.message : String(e), jobId });
      } finally { if (controller.current === ctrl) controller.current = null; }
    })();
    return () => ctrl.abort();
  }, [id, jobId, reconnectAttempt]);

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
    pendingCancel.current = false;
    controller.current = ctrl;
    setOpen(false);
    setState({ progress: 0 });
    try {
      const submittedFingerprint = await fingerprintPlan(plan);
      const requestedSettings = { resolution: res, burnCaptions: burn };
      ctrl.signal.throwIfAborted();
      if (DURABLE_JOBS && id) {
        // The enqueue response is retained even if this viewer navigates away meanwhile.
        const request = pendingEnqueue.current ?? { serverId, opts: { editPlan: plan, resolution: res, burnCaptions: burn }, key: crypto.randomUUID(), submittedFingerprint, requestedSettings };
        pendingEnqueue.current = request;
        const job = await enqueueExport(request.serverId, request.opts, request.key);
        actions.trackExportJob(id, { jobId: job.id, cursor: job.revision, submittedFingerprint: request.submittedFingerprint, requestedSettings: request.requestedSettings });
        pendingEnqueue.current = null;
        if (pendingCancel.current) await cancelJob(job.id);
        return;
      }
      for await (const ev of exportVideo(serverId, { editPlan: plan, resolution: res, burnCaptions: burn }, ctrl.signal)) {
        if (ctrl.signal.aborted) return;
        if (ev.type === "progress") setState({ progress: ev.progress });
        else if (ev.type === "ready") {
          setState({ url: ev.url });
          if (id) actions.recordExport(id, { ...ev, submittedFingerprint, requestedSettings });
        }
        else if (ev.type === "error") throw new Error(ev.message);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setState({ error: e instanceof Error ? e.message : String(e), retryOriginal: !!pendingEnqueue.current });
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }

  async function cancel() {
    if (jobId) {
      try {
        const job = await cancelJob(jobId);
        if (job.state === "cancelled" && id) { actions.clearExportJob(id, jobId); setState({ error: "Export cancelled." }); }
        else { setState({ progress: job.progress.fraction, stage: "Cancelling export" }); reconnect((n) => n + 1); }
      } catch (e) { setState({ error: e instanceof Error ? e.message : String(e), jobId }); }
    } else if (DURABLE_JOBS && id) { pendingCancel.current = true; setState({ progress: 0, stage: "Requesting cancellation" }); }
    else { controller.current?.abort(); setState(null); }
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
          <Button variant="primary" size="sm" disabled={disabled || !serverId || (rendering && !reconnectable)} onClick={() => reconnectable ? reconnect((n) => n + 1) : setOpen((o) => !o)} className="h-8">
            <IconExport size={14} />
            {reconnectable ? "Reconnect" : state && "progress" in state ? <span className="tabular font-mono">{Math.round(state.progress * 100)}%</span> : jobId ? "Pending" : "Export"}
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
        <Toast icon={<span className="size-2 animate-pulse rounded-full bg-agent" />} actions={<Button size="sm" variant="ghost" onClick={() => void cancel()}>Cancel</Button>}>
          {state.stage ?? "Rendering your edit"} · <span className="tabular font-mono">{Math.round(state.progress * 100)}%</span>
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
            <div className="flex gap-1"><button type="button" onClick={() => state.jobId ? reconnect((n) => n + 1) : void run()} className="h-7 rounded-full px-3 text-[12px] text-text-1 hover:bg-surface-3">
              {state.jobId ? "Reconnect" : state.retryOriginal ? "Retry original export" : "Retry"}
            </button>{state.jobId && <button type="button" onClick={() => void cancel()} className="h-7 rounded-full px-3 text-[12px] text-text-1 hover:bg-surface-3">Cancel export</button>}</div>
          }
        >
          {state.jobId ? "Export status unavailable" : "Export failed"} · {state.error}
        </Toast>
      )}
    </>
  );
}
