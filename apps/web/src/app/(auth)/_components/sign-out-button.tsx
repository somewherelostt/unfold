/** Drop-in sign-out control: <SignOutButton />. Posts to /auth/signout. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className={className ?? "h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-[120ms] hover:bg-surface-2"}
      >
        Sign out
      </button>
    </form>
  );
}
