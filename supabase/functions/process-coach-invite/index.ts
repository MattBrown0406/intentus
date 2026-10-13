import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Require authenticated caller — prevents tier spoofing via body params
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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { invite_code, coach_user_id } = await readBoundedJson(req, { maxBytes: 8192 });
    if ((invite_code != null && (typeof invite_code !== "string" || invite_code.length > 200)) ||
        (coach_user_id != null && (typeof coach_user_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(coach_user_id)))) {
      return new Response(JSON.stringify({ error: "Invalid invitation" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data, error } = await supabase.rpc("coach_accept_invite", {
      p_client_user_id: user.id,
      p_invite_code: invite_code ?? null,
      p_coach_user_id: coach_user_id ?? null,
    });
    if (error) {
      console.error("Invite redemption rejected", error.code);
      return new Response(JSON.stringify({ error: "Invitation could not be accepted. It may be inactive, expired, or full." }), {
        status: error.code === "42501" ? 403 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const limited = error instanceof RequestLimitError ? limitErrorResponse(error, corsHeaders) : null;
    if (limited) return limited;
    console.error("Process invite error:", error);
    return new Response(JSON.stringify({ error: "Invitation could not be processed. Please retry." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
