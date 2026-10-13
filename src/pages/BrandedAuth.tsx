import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth, bounded, safeDestination } from "@/contexts/AuthContext";
import { publicOrigin } from "@/lib/site";
import { useLocation } from "react-router-dom";
import { Navigate } from "react-router-dom";
import Seo from "@/components/seo/Seo";

interface Branding {
  coach_user_id: string;
  slug: string;
  company_name: string | null;
  logo_url: string | null;
  headshot_url: string | null;
  brand_primary: string;
  brand_secondary: string;
  brand_foreground: string;
  tagline: string | null;
}

const BrandedAuth = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const location = useLocation();

  const [branding, setBranding] = useState<Branding | null>(null);
  const [coachName, setCoachName] = useState("");
  const [loadingBranding, setLoadingBranding] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    if (!slug) return;
    // The route component is reused across /:slug changes; never show the
    // previous coach's branding (or a stale "not found") for the new slug.
    let active = true;
    setBranding(null); setCoachName(""); setNotFound(false); setLoadingBranding(true);
    const load = async () => {
      const { data, error } = await supabase.rpc("get_public_coach_branding", {
        _slug: slug,
      });
      if (!active) return;

      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) {
        setNotFound(true);
        setLoadingBranding(false);
        return;
      }

      setBranding({
        coach_user_id: row.coach_user_id,
        slug: row.slug,
        company_name: row.company_name,
        logo_url: row.logo_url,
        headshot_url: row.headshot_url,
        brand_primary: row.brand_primary,
        brand_secondary: row.brand_secondary,
        brand_foreground: row.brand_foreground,
        tagline: row.tagline,
      });
      setCoachName(row.coach_display_name || "");
      setLoadingBranding(false);
    };
    void load().catch(() => { if (active) { setNotFound(true); setLoadingBranding(false); } });
    return () => { active = false; };
  }, [slug]);


  if (user) return <Navigate to={safeDestination(location.state?.from)} replace />;

  if (loadingBranding) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Every unknown single-segment URL lands here; without its own tags it would
  // inherit the homepage title/canonical and be indexed as a soft 404.
  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Seo title="Page not found" description="This Intentus page doesn't exist." path={`/${slug ?? ""}`} noindex />
        <div className="text-center space-y-4">
          <h2 className="font-heading text-xl font-bold text-foreground">Coach not found</h2>
          <p className="text-muted-foreground">This coaching page doesn't exist.</p>
          <Button variant="hero" onClick={() => navigate("/auth")}>Go to main login</Button>
        </div>
      </div>
    );
  }

  if (!branding) return null;

  const primary = branding.brand_primary;
  const secondary = branding.brand_secondary;
  const foreground = branding.brand_foreground;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (showReset) {
        const { error } = await bounded(supabase.auth.resetPasswordForEmail(email, { redirectTo: `${publicOrigin()}/reset-password` }));
        if (error) throw error;
        toast({ title: "Check your email", description: "We sent you a password reset link." });
        setShowReset(false);
      } else if (isLogin) {
        const { error } = await bounded(supabase.auth.signInWithPassword({ email, password }));
        if (error) throw error;
      } else {
        const { data, error } = await bounded(supabase.auth.signUp({ email, password, options: {
          data: { display_name: displayName, coach_slug: slug }, emailRedirectTo: `${publicOrigin()}/auth`,
        } }));
        if (error) throw error;
        if (!data.session) toast({ title: "Check your email", description: "Confirm your email, then sign in to finish linking your coach." });
      }
    } catch (error) {
      toast({ title: "Authentication failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: `linear-gradient(135deg, ${primary}08, ${secondary}05, ${primary}03)`,
      }}
    >
      <Seo
        title={branding.company_name ? `Sign in to ${branding.company_name}` : "Coach sign in"}
        description={branding.tagline || "Create your account or sign in to your coach's Intentus program."}
        path={`/${branding.slug}`}
        noindex
      />
      <div className="w-full max-w-md">
        {/* Coach branding header */}
        <div className="flex flex-col items-center gap-3 mb-8">
          {branding.logo_url && (
            <img src={branding.logo_url} alt={branding.company_name || "Logo"} className="max-h-12 object-contain" />
          )}
          {branding.headshot_url && (
            <img
              src={branding.headshot_url}
              alt={coachName}
              className="h-16 w-16 rounded-full object-cover border-3"
              style={{ borderColor: primary }}
            />
          )}
          <div className="text-center">
            <h1 className="font-heading text-2xl font-bold" style={{ color: primary }}>
              {branding.company_name || "Welcome"}
            </h1>
            {branding.tagline && (
              <p className="text-sm text-muted-foreground mt-1">{branding.tagline}</p>
            )}
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-medium p-8 border border-border">
          <h2 className="font-heading text-xl font-bold text-foreground mb-1 text-center">
            {showReset ? "Reset password" : isLogin ? "Welcome back" : "Get started"}
          </h2>
          <p className="text-sm text-muted-foreground text-center mb-6">
            {showReset
              ? "Enter your email and we'll send you a reset link"
              : isLogin
              ? "Sign in to continue"
              : coachName
              ? `${coachName} has invited you to begin your journey`
              : "Create your account to begin"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && !showReset && (
              <div>
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            {!showReset && (
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>
            )}
            <Button
              type="submit"
              className="w-full font-semibold"
              style={{ backgroundColor: primary, color: foreground }}
              disabled={loading}
            >
              {loading
                ? "Loading..."
                : showReset
                ? "Send reset link"
                : isLogin
                ? "Sign in"
                : "Create account"}
            </Button>
          </form>

          <div className="mt-4 text-center space-y-2">
            {!showReset && isLogin && (
              <button
                onClick={() => setShowReset(true)}
                className="text-sm hover:underline"
                style={{ color: primary }}
              >
                Forgot password?
              </button>
            )}
            <p className="text-sm text-muted-foreground">
              {showReset ? (
                <button onClick={() => setShowReset(false)} className="hover:underline" style={{ color: primary }}>
                  Back to sign in
                </button>
              ) : isLogin ? (
                <>
                  Don't have an account?{" "}
                  <button onClick={() => setIsLogin(false)} className="hover:underline" style={{ color: primary }}>
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button onClick={() => setIsLogin(true)} className="hover:underline" style={{ color: primary }}>
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Powered by Intentus • Coaching and self-reflection tools, not medical advice.
        </p>
      </div>
    </div>
  );
};

export default BrandedAuth;
