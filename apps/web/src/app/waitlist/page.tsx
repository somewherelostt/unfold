import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { buttonClasses } from "@/components/ui/Button";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import "@/components/app/app.css";

export const metadata: Metadata = { title: "Join the waitlist · Unfold", description: "Hosted Unfold is on its way. Join the waitlist for public access, or run the source version yourself from GitHub." };

export default function WaitlistPage() {
  return <main className="uf-app uf-auth-page">
    <header className="uf-auth-header">
      <Link href="/" aria-label="Unfold home" className="inline-flex text-text-1"><BrandLogo width={120} height={29} /></Link>
      <Link href="/" className="uf-text-link">Back to home <span aria-hidden>↗</span></Link>
    </header>
    <div className="uf-auth-content">
      <div className="w-full max-w-[460px]">
        <p className="uf-kicker">A little more unfolding</p>
        <h1 className="uf-auth-title mt-3">Join the Unfold waitlist.</h1>
        <p className="mt-4 text-[15px] leading-7 text-text-2">We’re adding more features before opening hosted Unfold to everyone. Join the waitlist and be the first to know when public access is ready.</p>
        <div className="uf-card mt-7"><WaitlistForm /></div>
        <div className="mt-7 border-t border-hairline pt-6">
          <p className="text-[14px] font-medium">Want to use Unfold today?</p>
          <p className="mt-2 text-[13px] leading-6 text-text-2">Run the source version on your own machine. The code and setup instructions are on GitHub.</p>
          <a href="https://github.com/somewherelostt/unfold" target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "lg", "mt-4 w-full")}>Use the source version <span aria-hidden>↗</span></a>
        </div>
      </div>
    </div>
  </main>;
}
