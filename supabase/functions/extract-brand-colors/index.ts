import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import { safeFetchHTML, SafeFetchError } from "../_shared/safe-fetch.ts";
import { readBoundedJson, limitErrorResponse, RequestLimitError } from "../_shared/request-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") return new Response(null, { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Require authenticated caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url } = await readBoundedJson(req, { maxBytes: 8192 });
    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { html, url: parsed } = await safeFetchHTML(url);

    // Extract colors from CSS, meta tags, and inline styles
    const colors: string[] = [];

    // Look for theme-color meta tag
    const themeColorMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
    if (themeColorMatch) colors.push(themeColorMatch[1]);

    // Look for msapplication-TileColor
    const tileColorMatch = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i);
    if (tileColorMatch) colors.push(tileColorMatch[1]);

    // Extract hex colors from inline styles and CSS
    const hexMatches = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
    const rgbMatches = html.match(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g) || [];

    // Count color frequency
    const colorFreq: Record<string, number> = {};
    for (const c of hexMatches) {
      const normalized = c.toLowerCase();
      if (isNeutral(normalized)) continue;
      colorFreq[normalized] = (colorFreq[normalized] || 0) + 1;
    }
    for (const rgb of rgbMatches) {
      const hex = rgbToHex(rgb);
      if (!hex) continue;
      if (isNeutral(hex)) continue;
      colorFreq[hex] = (colorFreq[hex] || 0) + 1;
    }

    // Sort by frequency
    const sorted = Object.entries(colorFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color);

    // Combine: theme-color first, then most frequent
    const allColors = [...new Set([...colors, ...sorted])].slice(0, 5);

    // Try to extract logo
    let logoUrl: string | null = null;
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (ogImageMatch) {
      logoUrl = ogImageMatch[1];
      if (logoUrl.startsWith("/")) {
        logoUrl = `${parsed.origin}${logoUrl}`;
      }
    }

    // Extract site name
    let siteName: string | null = null;
    const ogSiteNameMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
    if (ogSiteNameMatch) siteName = ogSiteNameMatch[1];
    if (!siteName) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) siteName = titleMatch[1].split(/[|\-–—]/)[0].trim();
    }

    return new Response(JSON.stringify({
      colors: allColors,
      primary: allColors[0] || "#14B8A6",
      secondary: allColors[1] || "#F97316",
      logo_url: logoUrl,
      site_name: siteName,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const limited = error instanceof RequestLimitError ? limitErrorResponse(error, corsHeaders) : null;
    if (limited) return limited;
    console.error("Brand extraction error:", error);
    // Only curated SafeFetchError messages are user-facing; runtime/network
    // errors can carry resolved addresses or internals.
    return new Response(JSON.stringify({ error: error instanceof SafeFetchError ? error.message : "Brand extraction failed" }), {
      status: error instanceof SafeFetchError ? error.status : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const avg = (r + g + b) / 3;
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  if (avg > 230 || avg < 25) return true;
  if (maxDiff < 20) return true;
  return false;
}

function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => parseInt(n, 10));
  if ([r, g, b].some((v) => v < 0 || v > 255 || Number.isNaN(v))) return null;
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
}
