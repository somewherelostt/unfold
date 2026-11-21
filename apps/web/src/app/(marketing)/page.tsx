import type { Metadata } from "next";
import "@/components/marketing/marketing.css";
import { AgentDecides, Faq, FinalCta, Footer, Hero, HowItWorks, Nav, Variants } from "@/components/marketing/Sections";
import { ProductMockup } from "@/components/marketing/ProductMockup";
import { Showcase } from "@/components/marketing/Showcase";
import { SpeedSection } from "@/components/marketing/SpeedSection";

export const metadata: Metadata = {
  title: "Unfold · Turn one clip into every version that could go viral",
  description:
    "Upload a raw clip. An agent on Kimi K3.1 Pro (Cerebras) adds captions, beat-synced music, transitions and meme sounds, nine different ways, in seconds.",
};

// Section order alternates page and raised bands instead of divider lines:
// hero + mockup · examples · how (band) · agent · speed (band) · variants · FAQ (band) · CTA
export default function Home() {
  return (
    <div className="mk-root flex-1 overflow-x-clip bg-bg">
      <Nav />
      <main>
        <Hero />
        <ProductMockup />
        <Showcase />
        <HowItWorks />
        <AgentDecides />
        <SpeedSection />
        <Variants />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
