/** Drop-in sign-out control: <SignOutButton />. Posts to /auth/signout. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className={className ?? "h-9 rounded-sm border border-hairline-strong bg-surface-2 px-3 text-[13px] font-medium text-text-1 transition-colors duration-[120ms] hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-3"}
      >
        Sign out
      </button>
    </form>
  );
}
