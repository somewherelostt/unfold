import { buttonClasses } from "@/components/ui/Button";

/** Drop-in sign-out control: <SignOutButton />. Posts to /auth/signout. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className={className ?? buttonClasses("secondary")}
      >
        Sign out
      </button>
    </form>
  );
}
