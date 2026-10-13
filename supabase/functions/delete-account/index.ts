import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  AccountDeletionError,
  deleteAccountWithAssets,
} from "../_shared/delete-assets.ts";
import {
  cancelSquareSubscriptions,
  squareConfig,
  squareRequest,
} from "../_shared/square.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth
      .getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Deleting the account cascades square_checkouts, but Square would keep
    // charging the $299.99/month Coach subscription with no account behind it.
    // Stop renewal first; on any failure abort before deleting anything.
    try {
      const { data: checkouts, error: checkoutError } = await admin
        .from("square_checkouts")
        .select("subscription_id")
        .eq("user_id", user.id)
        .not("subscription_id", "is", null);
      if (checkoutError) throw checkoutError;
      const ids = (checkouts ?? []).map((row) => row.subscription_id as string);
      if (ids.length) {
        const config = squareConfig((key) => Deno.env.get(key));
        await cancelSquareSubscriptions(
          ids,
          (path, body) => squareRequest(config, path, body),
        );
      }
    } catch (error) {
      throw new AccountDeletionError("billing", error);
    }

    // Nontransactional Storage first; only Auth/public cleanup can roll back.
    // Concurrent uploads remain possible until a durable job + write fence exists.
    await deleteAccountWithAssets(
      admin.storage.from("coach-assets"),
      user.id,
      (id, softDelete) => admin.auth.admin.deleteUser(id, softDelete),
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("delete-account error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof AccountDeletionError
          ? error.message
          : "Account deletion failed",
        ...(error instanceof AccountDeletionError
          ? { phase: error.phase, retryable: true }
          : {}),
      }),
      {
        status: error instanceof AccountDeletionError ? 503 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
