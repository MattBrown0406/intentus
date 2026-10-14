import Navbar from "@/components/landing/Navbar";
import PricingSection from "@/components/landing/PricingSection";
import Footer from "@/components/landing/Footer";
import TrustSection from "@/components/landing/TrustSection";
import FAQPreviewSection from "@/components/landing/FAQPreviewSection";
import { HomeHero } from "@/components/landing/home/HomeHero";
import { InteractiveDemo } from "@/components/landing/home/InteractiveDemo";
import { RhythmLoop } from "@/components/landing/home/RhythmLoop";
import { FeatureShowcase } from "@/components/landing/home/FeatureShowcase";
import { FinalCta } from "@/components/landing/home/FinalCta";
import Seo from "@/components/seo/Seo";
import { faqJsonLd, organizationJsonLd, softwareJsonLd } from "@/lib/site";

const Index = () => {
  return (
    <div className="min-h-screen bg-background [overflow-x:clip]">
      <Seo jsonLd={[organizationJsonLd, softwareJsonLd, faqJsonLd]} />
      <Navbar />
      <main>
        <HomeHero />
        <InteractiveDemo />
        <RhythmLoop />
        <FeatureShowcase />
        <TrustSection />
        <PricingSection />
        <FAQPreviewSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
