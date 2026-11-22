import type { Metadata } from "next";
import "@/components/marketing/marketing.css";
import { Features } from "@/components/marketing/Features";
import { Hero, Nav } from "@/components/marketing/Hero";
import { RawToEdit } from "@/components/marketing/RawToEdit";
import { Faq, FinalCta, Footer } from "@/components/marketing/Sections";
import { Ways } from "@/components/marketing/Ways";
import { Speed } from "@/components/marketing/Speed";

export const metadata: Metadata = {
  title: "Unfold · Raw footage in. Viral edit out.",
  description:
    "Turn raw footage into one polished edit with captions, beat-synced music, transitions and sound effects, powered by Kimi K3.1 Pro on Cerebras.",
};

export default function Home() {
  return (
    <div data-theme="light" className="mk-root mk-light flex-1 overflow-x-clip">
      <Nav />
      <main>
        <Hero />
        <RawToEdit />
        <Features />
        <Ways />
        <Speed />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
