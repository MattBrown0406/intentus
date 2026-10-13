import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from '@capacitor/core';
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { Purchases, type PurchasesPackage } from "@revenuecat/purchases-capacitor";
import AppBreadcrumb from "@/components/AppBreadcrumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { brandLogo as logo } from "@/lib/brand";
import { getTierCapability, normalizePlanTier, tierCovers, type PlanTier } from "@/lib/tier-policy";
import { functionErrorMessage } from "@/lib/function-errors";
import {
  withRevenueCatIdentity,
  isNativeRevenueCatAvailable,
  REVENUECAT_PRODUCT_IDS,
  syncSupabasePlanTierFromCustomerInfo,
  waitForVerifiedPlanTier,
} from "@/lib/revenuecat";

type Plan = {
  tier: Exclude<PlanTier, "free">;
  name: string;
  productId: string;
  fallbackPrice: string;
  summary: string;
  featured?: boolean;
  features: string[];
};

const plans: Plan[] = [
  {
    tier: "exec",
    name: "Executive",
    productId: REVENUECAT_PRODUCT_IDS.exec,
    fallbackPrice: "$39.99",
    summary: "Full AI operating coach for execution rhythm.",
    featured: true,
    features: [
      "Full operating audit and report",
      "AI check-in debriefs",
      "AI Operating Coach chat",
      "Drift tracking and accountability history",
    ],
  },
  {
    tier: "premium",
    name: "Premium",
    productId: REVENUECAT_PRODUCT_IDS.premium,
    fallbackPrice: "$79.99",
    summary: "Sharper Mirror Mode and plan refresh support.",
    features: [
      "Everything in Executive",
      "Mirror Mode call-outs",
      "Rotating AI coaching signals",
      "Quarterly re-audits and AI plan refreshes",
    ],
  },
  {
    tier: "coach",
    name: "Coach",
    productId: REVENUECAT_PRODUCT_IDS.coach,
    fallbackPrice: "$299.99",
    summary: "Premium AI plus client accountability workflows.",
    features: [
      "Everything in Premium",
      "Unlimited client accounts",
      "Assign clients to tiers",
      "Review client reports, audits, and check-ins",
    ],
  },
];

const APP_STORE_URL = "https://apps.apple.com/app/id6744403069";
const coachPlan = plans.find((p) => p.tier === "coach")!;

const Subscribe = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentTier, setCurrentTier] = useState<PlanTier>("free");
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionProductId, setActionProductId] = useState<string | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [webCheckoutLoading, setWebCheckoutLoading] = useState(false);
  const nativeAvailable = isNativeRevenueCatAvailable();
  const account = useRef(user?.id);
  account.current = user?.id;
  const busy = useRef(false);
  useEffect(() => () => { account.current = undefined; }, []);

  const loadTier = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("plan_tier")
      .eq("user_id", user.id)
      .single();
    if (account.current === user.id) setCurrentTier(normalizePlanTier(data?.plan_tier));
  };

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);
      try {
        await loadTier();
        if (nativeAvailable) {
          const offerings = await withRevenueCatIdentity(user.id, () => Purchases.getOfferings());
          if (account.current === user.id) setPackages(offerings.current?.availablePackages ?? []);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load subscription options.";
        toast({ title: "Subscription setup issue", description: message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeAvailable, user]);

  useEffect(() => {
    if (searchParams.get("payment") === "success") {
      toast({
        title: "Checkout returned",
        description: "We are checking your plan. Access activates after payment verification.",
      });
      // Square's webhook usually lands after the redirect: poll the verified tier.
      if (user) {
        const id = user.id;
        void waitForVerifiedPlanTier(id, "coach", { isCurrent: () => account.current === id })
          .then((tier) => { if (account.current === id && tier) setCurrentTier(tier); })
          .catch(() => undefined);
      }
      searchParams.delete("payment");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const packageByProductId = useMemo(() => {
    return new Map(packages.map((pkg) => [pkg.product.identifier, pkg]));
  }, [packages]);

  const handlePurchase = async (plan: Plan) => {
    if (!user || !nativeAvailable || busy.current) return;

    const selectedPackage = packageByProductId.get(plan.productId);
    if (!selectedPackage) {
      toast({
        title: "Subscription unavailable",
        description: "This product is not available from RevenueCat yet. Check the offering configuration and try again.",
        variant: "destructive",
      });
      return;
    }

    busy.current = true;
    setActionProductId(plan.productId);
    try {
      await withRevenueCatIdentity(user.id, () => Purchases.purchasePackage({ aPackage: selectedPackage }));
      // The store has charged by now; a failed verification read must not say "Purchase failed".
      const newTier = await waitForVerifiedPlanTier(user.id, plan.tier, { isCurrent: () => account.current === user.id }).catch(() => null);
      if (account.current !== user.id) return;
      if (newTier && tierCovers(newTier, plan.tier)) {
        setCurrentTier(newTier);
        toast({ title: "Subscription active", description: `${getTierCapability(newTier).label} is now active.` });
        navigate("/dashboard");
      } else {
        toast({ title: "Purchase complete", description: "Your plan is awaiting server verification. Try Restore Purchases in a moment." });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The purchase could not be completed.";
      if (!message.toLowerCase().includes("cancel")) {
        toast({ title: "Purchase failed", description: message, variant: "destructive" });
      }
    } finally {
      busy.current = false;
      setActionProductId(null);
    }
  };

  const handleWebCoachCheckout = async () => {
    if (!user || busy.current) return;
    busy.current = true;
    setWebCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-square-checkout", {
        body: { plan: "coach_monthly" },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Could not start web checkout."));
      const url = (data as { checkout_url?: string })?.checkout_url;
      if (!url) throw new Error("No checkout URL returned");
      if (account.current !== user.id) return;
      if (new URL(url).protocol !== "https:") throw new Error("Invalid checkout URL");
      window.location.href = url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start web checkout.";
      toast({ title: "Checkout failed", description: message, variant: "destructive" });
      busy.current = false;
      setWebCheckoutLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!user) return;
    if (!nativeAvailable) {
      toast({ title: "Open Intentus on iPhone", description: "Restore Purchases is available in the iOS app." });
      return;
    }

    if (busy.current) return;
    busy.current = true;
    setRestoreLoading(true);
    try {
      const { customerInfo } = await withRevenueCatIdentity(user.id, () => Purchases.restorePurchases());
      const restoredTier = await syncSupabasePlanTierFromCustomerInfo(user.id, customerInfo);
      if (account.current !== user.id) return;
      if (restoredTier) {
        setCurrentTier(restoredTier);
        toast({ title: "Purchases restored", description: `${getTierCapability(restoredTier).label} is now active.` });
      } else {
        toast({ title: "No verified subscription yet", description: "Your plan may still be processing. Please try again shortly." });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Restore Purchases failed.";
      toast({ title: "Restore failed", description: message, variant: "destructive" });
    } finally {
      busy.current = false;
      setRestoreLoading(false);
    }
  };

  const renderPlanCard = (plan: Plan) => {
    const rcPackage = packageByProductId.get(plan.productId);
    const price = rcPackage?.product.priceString ?? plan.fallbackPrice;
    const active = currentTier === plan.tier;
    return (
      <article
        key={plan.tier}
        className={`rounded-2xl border bg-card p-6 shadow-soft ${plan.featured ? "border-primary/40 ring-1 ring-primary/20" : "border-border/60"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-bold text-foreground">{plan.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{plan.summary}</p>
          </div>
          {plan.featured && <Badge>Popular</Badge>}
        </div>
        <div className="mt-6">
          <span className="font-heading text-4xl font-bold text-foreground">{price}</span>
          <span className="text-muted-foreground">/mo</span>
        </div>
        <Button
          variant={plan.featured ? "hero" : "hero-outline"}
          className="mt-6 w-full"
          disabled={active || actionProductId !== null || restoreLoading || loading || !rcPackage}
          onClick={() => handlePurchase(plan)}
        >
          {actionProductId === plan.productId ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Purchasing...</>
          ) : active ? (
            "Current plan"
          ) : (
            `Choose ${plan.name}`
          )}
        </Button>
        <ul className="mt-6 space-y-3">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm text-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Go back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Link to="/dashboard" className="flex items-center">
              <img src={logo} alt="Intentus" className="h-8 w-auto object-contain" />
            </Link>
          </div>
          {nativeAvailable && (
            <Button variant="ghost" size="sm" onClick={handleRestore} disabled={restoreLoading || actionProductId !== null || loading}>
              {restoreLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Restore
            </Button>
          )}
        </div>
      </nav>

      <AppBreadcrumb />

      <main className="container mx-auto px-4 py-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-7 w-7" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground md:text-5xl">Choose your Intentus plan</h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Upgrade from the Starter snapshot to ongoing AI coaching, sharper drift detection, and a tighter operating rhythm.
          </p>
          <div className="mt-4 flex justify-center">
            <Badge variant="outline">Current plan: {getTierCapability(currentTier).label}</Badge>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : nativeAvailable ? (
          <div className="mx-auto mt-10 grid max-w-6xl gap-6 md:grid-cols-3">
            {plans.map(renderPlanCard)}
          </div>
        ) : Capacitor.isNativePlatform() ? (
          <p className="mt-10 text-center">Subscriptions are unavailable on this platform until its store is configured. No payment has been taken.</p>
        ) : (
          <div className="mx-auto mt-10 max-w-2xl space-y-6">
            {/* Executive + Premium: iOS-only */}
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
              <img src={logo} alt="Intentus" className="mx-auto mb-6 h-14 w-auto object-contain" />
              <h2 className="font-heading text-2xl font-bold text-foreground">
                Subscriptions are managed in the iOS app.
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Executive and Premium plans are billed through Apple. Download Intentus on your iPhone or iPad to subscribe.
              </p>
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center justify-center"
              >
                <img
                  src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg"
                  alt="Download on the App Store"
                  className="h-12 w-auto"
                />
              </a>
            </div>

            {/* Coach card: web checkout */}
            <article className="rounded-2xl border border-primary/40 bg-card p-6 shadow-soft ring-1 ring-primary/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-2xl font-bold text-foreground">{coachPlan.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{coachPlan.summary}</p>
                </div>
                <Badge>Web checkout</Badge>
              </div>
              <div className="mt-6">
                <span className="font-heading text-4xl font-bold text-foreground">{coachPlan.fallbackPrice}</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <Button
                variant="hero"
                className="mt-6 w-full"
                disabled={webCheckoutLoading || currentTier === "coach"}
                onClick={handleWebCoachCheckout}
              >
                {webCheckoutLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting…</>
                ) : currentTier === "coach" ? (
                  "Current plan"
                ) : (
                  "Subscribe on Web — $299.99/mo"
                )}
              </Button>
              <ul className="mt-6 space-y-3">
                {coachPlan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Coach renews at $299.99 USD every month until canceled. Billed through Square. Contact support to manage or cancel before your next billing date.
              </p>
            </article>
          </div>
        )}

        <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Apple in-app subscriptions are managed in your Apple ID settings. Web Coach subscriptions are processed by Square.
            Intentus provides coaching and self-reflection tools, not medical, legal, financial, or crisis advice.{" "}
            By subscribing, you agree to our{" "}
            <Link to="/terms" className="underline hover:text-foreground transition-colors">Terms of Use</Link>
            {" "}and{" "}
            <Link to="/privacy" className="underline hover:text-foreground transition-colors">Privacy Policy</Link>.
          </p>
        </div>
      </main>
    </div>
  );
};

export default Subscribe;
