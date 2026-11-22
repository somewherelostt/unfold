import "server-only";

export type SseError = { message: string; errorCode?: string; retryable?: boolean };

/** Server-Sent Events response. `run` gets a send(event, data) and should return when done. */
export function sse(run: (send: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>, signal: AbortSignal, formatError?: (error: unknown) => SseError): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client went away */
        }
      };
      const ping = setInterval(() => send("ping", { t: Date.now() }), 10_000);
      try {
        await run(send, signal);
      } catch (e) {
        if (!formatError) send("error", { message: e instanceof Error ? e.message : String(e) });
        else {
          try { send("error", formatError(e)); }
          catch { send("error", { message: "The request could not be completed." }); }
        }
      } finally {
        clearInterval(ping);
        send("done", {});
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
