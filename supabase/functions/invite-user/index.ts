import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import { coachInviteMayLink, inviteTier } from "../_shared/payment-security.ts";
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

    // Require authenticated coach-tier caller
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

    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // Admin.tsx is the caller in the app (admins comp a tier, no coach link);
    // active coaches may also invite clients (linked + tier via coach grant).
    const [{ data: profile, error: profileReadError }, { data: adminRole, error: roleError }] = await Promise.all([
      supabase.from("profiles").select("plan_tier, is_active").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle(),
    ]);
    if (profileReadError || roleError) throw new Error("Caller authorization lookup failed");
    const isAdmin = !!adminRole;
    const isCoach = profile?.plan_tier === "coach" && profile?.is_active === true;

    if (!isAdmin && !isCoach) {
      return json({ error: "Admin or active Coach required" }, 403);
    }

    const { email, display_name, plan_tier: requestedTier, coach_user_id: requestedCoach, coach_name } = await readBoundedJson(req, { maxBytes: 8192 });
    const plan_tier = inviteTier(requestedTier);
    // Admins invite without a coach link unless they explicitly invite as their own (coach) client.
    const coach_user_id = isCoach && (!isAdmin || requestedCoach === user.id) ? user.id : null;
    if (!plan_tier || (requestedCoach && requestedCoach !== user.id)) {
      return json({ error: "Invalid coach or client tier" }, 403);
    }

    if (typeof email !== "string" || !email || typeof display_name !== "string" || !display_name.trim() ||
        email.length > 320 || display_name.length > 200 || (coach_name != null && (typeof coach_name !== "string" || coach_name.length > 200))) {
      return json({ error: "email and display_name are required" }, 400);
    }

    // Invite the user - this sends them an email with a link to set their password
    const inviteNonce = crypto.randomUUID();
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        display_name,
        ...(coach_user_id ? { coach_user_id, coach_invite_nonce: inviteNonce } : {}),
        ...(coach_name ? { invited_by: coach_name } : {}),
      },
      // Must match the production web origin (src/lib/site.ts SITE_URL) and the Auth redirect allow-list.
      redirectTo: "https://intentusai.com/onboarding",
    });


    if (inviteError) {
      console.error("Invite rejected:", inviteError.status);
      return json({ error: "Invitation could not be sent. The email may already have an account." }, 409);
    }

    const invited = inviteData.user;
    const userId = invited.id;

    if (coach_user_id) {
      // GoTrue re-invites an EXISTING unconfirmed account and returns it. Never
      // attach a pre-existing self-signup to a coach (that would expose the
      // person's data to the coach without consent); only accounts created by
      // this invite, or previously invited by this same coach, may be linked.
      // (A created_at recency window is not proof: a stranger who self-signed up
      // minutes ago and has not confirmed yet would be linked without consent.)
      if (!coachInviteMayLink(invited, inviteNonce, coach_user_id)) {
        return json({ error: "Invitation could not be sent. The email may already have an account." }, 409);
      }

      // Profile row is created by the auth trigger; only set the display name.
      // Paid access for coach clients is a coach grant aggregated by
      // recompute_user_plan(). Writing profiles.plan_tier here would be captured
      // as a permanent 'legacy' entitlement that survives unlinking/coach churn.
      const { error: profileError } = await supabase.from("profiles").upsert({
        user_id: userId,
        display_name,
        onboarding_completed: false,
      }, { onConflict: "user_id" });
      if (profileError) throw profileError;

      const { error: linkError } = await supabase.from("coach_clients").upsert({
        coach_user_id,
        client_user_id: userId,
        assigned_tier: plan_tier,
      }, { onConflict: "coach_user_id,client_user_id", ignoreDuplicates: true });
      if (linkError) throw linkError;

      const { error: recomputeError } = await supabase.rpc("recompute_user_plan", { p_user_id: userId });
      if (recomputeError) throw recomputeError;
    } else {
      // Admin comp grant: a direct, server-managed profile tier (recorded by the
      // rc_preserve_external_grant trigger as an admin/legacy grant).
      const { error: profileError } = await supabase.from("profiles").upsert({
        user_id: userId,
        display_name,
        plan_tier,
        onboarding_completed: false,
      }, { onConflict: "user_id" });
      if (profileError) throw profileError;
    }

    return new Response(JSON.stringify({ success: true, user_id: userId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const limited = error instanceof RequestLimitError ? limitErrorResponse(error, corsHeaders) : null;
    if (limited) return limited;
    console.error("Invite error:", error);
    return new Response(JSON.stringify({ error: "Invitation failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
