import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { coachSlugError } from "@/lib/coach-slug";
import {
  Palette, Upload, Globe, Wand2, Copy, Eye, Image, User
} from "lucide-react";

interface CoachBranding {
  id?: string;
  coach_user_id: string;
  slug: string;
  company_name: string;
  website_url: string;
  logo_url: string | null;
  headshot_url: string | null;
  brand_primary: string;
  brand_secondary: string;
  brand_foreground: string;
  tagline: string;
}

const CoachBrandingSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [branding, setBranding] = useState<CoachBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const logoRef = useRef<HTMLInputElement>(null);
  const headshotRef = useRef<HTMLInputElement>(null);

  // Form state
  const [slug, setSlug] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [brandPrimary, setBrandPrimary] = useState("#14B8A6");
  const [brandSecondary, setBrandSecondary] = useState("#F97316");
  const [brandForeground, setBrandForeground] = useState("#ffffff");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(null);

  const loadBranding = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("coach_branding")
      .select("*")
      .eq("coach_user_id", user.id)
      .single();

    if (data) {
      const b = data as any;
      setBranding(b);
      setSlug(b.slug || "");
      setCompanyName(b.company_name || "");
      setTagline(b.tagline || "");
      setBrandPrimary(b.brand_primary || "#14B8A6");
      setBrandSecondary(b.brand_secondary || "#F97316");
      setBrandForeground(b.brand_foreground || "#ffffff");
      setLogoUrl(b.logo_url);
      setHeadshotUrl(b.headshot_url);
      setWebsiteUrl(b.website_url || "");
    } else {
      // Generate default slug from display name
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .single();
      if (profile) {
        const name = (profile as any).display_name || "";
        setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
        setCompanyName(name);
      }
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadBranding();
  }, [user, loadBranding]);

  const extractColors = async () => {
    if (!websiteUrl) return;
    setExtracting(true);
    try {
      let url = websiteUrl;
      if (!url.startsWith("http")) url = `https://${url}`;

      const { data, error } = await supabase.functions.invoke("extract-brand-colors", {
        body: { url },
      });

      if (error) throw error;

      if (data.primary) setBrandPrimary(data.primary);
      if (data.secondary) setBrandSecondary(data.secondary);
      if (data.site_name && !companyName) setCompanyName(data.site_name);

      toast({ title: "Colors extracted!", description: `Found ${data.colors?.length || 0} brand colors from your website.` });
    } catch (e: any) {
      toast({ title: "Extraction failed", description: e.message, variant: "destructive" });
    }
    setExtracting(false);
  };

  const uploadFile = async (file: File, type: "logo" | "headshot") => {
    if (!user) return;
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${type}.${ext}`;

    const { error } = await supabase.storage
      .from("coach-assets")
      .upload(path, file, { upsert: true });

    if (error) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      return null;
    }

    const { data: urlData } = supabase.storage.from("coach-assets").getPublicUrl(path);
    return urlData.publicUrl;
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadFile(file, "logo");
    if (url) setLogoUrl(url + "?t=" + Date.now());
  };

  const handleHeadshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadFile(file, "headshot");
    if (url) setHeadshotUrl(url + "?t=" + Date.now());
  };

  const saveBranding = async () => {
    if (!user) return;
    const slugError = coachSlugError(slug);
    if (slugError) {
      toast({ title: "Invalid URL slug", description: slugError, variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload = {
      coach_user_id: user.id,
      slug,
      company_name: companyName,
      website_url: websiteUrl,
      logo_url: logoUrl,
      headshot_url: headshotUrl,
      brand_primary: brandPrimary,
      brand_secondary: brandSecondary,
      brand_foreground: brandForeground,
      tagline,
    };

    let error;
    if (branding?.id) {
      ({ error } = await supabase
        .from("coach_branding")
        .update(payload as any)
        .eq("id", branding.id));
    } else {
      ({ error } = await supabase
        .from("coach_branding")
        .insert(payload as any));
    }

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Branding saved!" });
      loadBranding();
    }
    setSaving(false);
  };

  const customDomain = "https://intentusai.com";
  const brandedUrl = `${customDomain}/${slug}`;

  if (loading) return null;

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h2 className="font-heading text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        <Palette className="h-5 w-5 text-primary" /> White Label Branding
      </h2>

      <div className="space-y-6">
        {/* URL Slug */}
        <div>
          <Label className="text-sm font-medium">Your branded URL</Label>
          <div className="flex gap-2 mt-1">
            <div className="flex-1 flex items-center bg-muted/50 rounded-lg px-3">
              <span className="text-sm text-muted-foreground">https://intentusai.com/</span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                className="border-0 bg-transparent px-0 font-medium"
                placeholder="your-name"
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(brandedUrl); toast({ title: "Copied!" }); }}>
              <Copy className="h-4 w-4" />
            </Button>
            {slug && (
              <Button variant="outline" size="icon" onClick={() => window.open(brandedUrl, "_blank")}>
                <Eye className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Company Name + Tagline */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium">Company / Brand Name</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your Coaching Brand" />
          </div>
          <div>
            <Label className="text-sm font-medium">Tagline</Label>
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Coaching leaders to lead with intent" />
          </div>
        </div>

        {/* Website + Extract */}
        <div>
          <Label className="text-sm font-medium">Website URL (for color extraction)</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yoursite.com"
              className="flex-1"
            />
            <Button variant="outline" onClick={extractColors} disabled={extracting || !websiteUrl}>
              <Wand2 className="h-4 w-4 mr-1" /> {extracting ? "Extracting..." : "Extract Colors"}
            </Button>
          </div>
        </div>

        {/* Colors */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Brand Colors</Label>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <input type="color" value={brandPrimary} onChange={(e) => setBrandPrimary(e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
              <div>
                <p className="text-xs text-muted-foreground">Primary</p>
                <p className="text-xs font-mono">{brandPrimary}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="color" value={brandSecondary} onChange={(e) => setBrandSecondary(e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
              <div>
                <p className="text-xs text-muted-foreground">Secondary</p>
                <p className="text-xs font-mono">{brandSecondary}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="color" value={brandForeground} onChange={(e) => setBrandForeground(e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
              <div>
                <p className="text-xs text-muted-foreground">Button Text</p>
                <p className="text-xs font-mono">{brandForeground}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Logo + Headshot uploads */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">Logo</Label>
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => logoRef.current?.click()}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="max-h-16 mx-auto object-contain" />
              ) : (
                <div className="space-y-2">
                  <Image className="h-8 w-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">Click to upload logo</p>
                </div>
              )}
            </div>
            <input ref={logoRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>
          <div>
            <Label className="text-sm font-medium mb-2 block">Headshot</Label>
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => headshotRef.current?.click()}
            >
              {headshotUrl ? (
                <img src={headshotUrl} alt="Headshot" className="max-h-16 mx-auto rounded-full object-cover" />
              ) : (
                <div className="space-y-2">
                  <User className="h-8 w-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">Click to upload headshot</p>
                </div>
              )}
            </div>
            <input ref={headshotRef} type="file" accept="image/*" onChange={handleHeadshotUpload} className="hidden" />
          </div>
        </div>

        {/* Preview */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Preview</Label>
          <div className="rounded-xl border border-border p-6 text-center" style={{ background: `linear-gradient(135deg, ${brandPrimary}15, ${brandSecondary}10)` }}>
            <div className="flex items-center justify-center gap-3 mb-3">
              {logoUrl && <img src={logoUrl} alt="Logo" className="h-8 object-contain" />}
              {headshotUrl && <img src={headshotUrl} alt="Coach" className="h-10 w-10 rounded-full object-cover border-2" style={{ borderColor: brandPrimary }} />}
            </div>
            <h3 className="font-heading text-lg font-bold" style={{ color: brandPrimary }}>{companyName || "Your Brand"}</h3>
            {tagline && <p className="text-sm text-muted-foreground mt-1">{tagline}</p>}
            <div className="mt-4 inline-block px-6 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: brandPrimary, color: brandForeground }}>
              Sign In
            </div>
          </div>
        </div>

        <Button variant="hero" onClick={saveBranding} disabled={saving} className="w-full">
          {saving ? "Saving..." : "Save Branding"}
        </Button>
      </div>
    </div>
  );
};

export default CoachBrandingSettings;
