"use client";

import { useRef, type ReactNode } from "react";

/** Every plain app CTA submits the most recently used landing prompt first. */
export function LandingHandoff({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const recent = useRef<HTMLFormElement | null>(null);
  const hasDraft = (form: HTMLFormElement) => !!form.querySelector("textarea")?.value.trim() || !!form.querySelector('[aria-label="Remove clip"]');

  return (
    <div ref={root} data-theme="light" className="mk-root mk-light flex-1 overflow-x-clip"
      onFocusCapture={(event) => {
        const form = (event.target as HTMLElement).closest<HTMLFormElement>(".mk-prompt-shell form");
        if (form) recent.current = form;
      }}
      onClickCapture={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
        if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || url.pathname !== "/app" || url.search) return;
        const forms = Array.from(root.current?.querySelectorAll<HTMLFormElement>(".mk-prompt-shell form") ?? []);
        const form = recent.current?.isConnected && hasDraft(recent.current) ? recent.current : forms.find(hasDraft);
        if (!form) return;
        event.preventDefault();
        event.stopPropagation();
        form.requestSubmit();
      }}>
      {children}
    </div>
  );
}
