import { Link } from "react-router-dom";
import { AppStoreBadge } from "./AppStoreBadge";
import { Reveal } from "./Reveal";

export function FinalCta() {
  return (
    <section className="px-4 py-24 sm:py-28">
      <Reveal>
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[36px] bg-[linear-gradient(135deg,hsl(174_84%_24%),hsl(188_70%_22%),hsl(214_55%_22%))] px-6 py-16 text-center shadow-glow sm:px-16">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/15 blur-2xl motion-safe:animate-[drift_16s_ease-in-out_infinite]" />
          <div aria-hidden="true" className="absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-[hsl(37_72%_48%/0.35)] blur-2xl motion-safe:animate-[drift_20s_ease-in-out_infinite_reverse]" />
          <div className="relative">
            <h2 className="font-heading text-3xl font-bold tracking-tight text-white md:text-5xl">You already know what matters.</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/85">Intentus makes it harder to keep avoiding it. Start with the audit and see the one decision you’ve been putting off.</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <AppStoreBadge className="bg-[hsl(220_25%_10%)]" />
              <Link to="/sample" className="rounded-2xl border border-white/40 px-6 py-4 font-semibold text-white transition-colors hover:bg-white/10">
                Try the 2-minute sample
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
