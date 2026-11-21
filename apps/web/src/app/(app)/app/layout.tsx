import "@/components/app/app.css";

/** Product UI shell: scopes the app tokens (`.uf-app`) to every /app screen. */
export default function ProductLayout({ children }: LayoutProps<"/app">) {
  return <div className="uf-app flex min-h-dvh flex-1 flex-col bg-bg">{children}</div>;
}
