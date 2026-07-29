import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

// Replace this value only in the one-time deployment payload. Never commit the
// plaintext bootstrap token. Redeploy this function as disabled after success.
const BOOTSTRAP_TOKEN_SHA256 = "REPLACE_AT_DEPLOY_TIME";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const token = request.headers.get("x-bootstrap-token") ?? "";
  if (
    BOOTSTRAP_TOKEN_SHA256 === "REPLACE_AT_DEPLOY_TIME" ||
    (await sha256(token)) !== BOOTSTRAP_TOKEN_SHA256
  ) {
    return new Response("Not found", { status: 404 });
  }

  const { prohorPassword, kamradPassword } = await request.json();
  if (
    typeof prohorPassword !== "string" ||
    typeof kamradPassword !== "string"
  ) {
    return Response.json({ error: "Both passwords are required" }, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const users = [
    { username: "Prohor", email: "prohor@knopik.local", password: prohorPassword, admin: false },
    { username: "Kamrad", email: "kamrad@knopik.local", password: kamradPassword, admin: true },
  ];
  const created: string[] = [];

  const { data: existingData, error: listError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    return Response.json({ error: listError.message }, { status: 500 });
  }

  for (const player of users) {
    const existing = existingData.users.find(
      (candidate) => candidate.email?.toLowerCase() === player.email,
    );
    let playerId = existing?.id;

    if (playerId) {
      const { error } = await supabase.auth.admin.updateUserById(playerId, {
        password: player.password,
        user_metadata: { username: player.username },
      });
      if (error) {
        return Response.json({ error: error.message, created }, { status: 400 });
      }
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: player.email,
        password: player.password,
        email_confirm: true,
        user_metadata: { username: player.username },
      });
      if (error) {
        return Response.json({ error: error.message, created }, { status: 400 });
      }
      playerId = data.user.id;
      created.push(player.username);
    }

    if (player.admin) {
      const { error: adminError } = await supabase
        .from("profiles")
        .update({ is_admin: true, updated_at: new Date().toISOString() })
        .eq("id", playerId);
      if (adminError) {
        return Response.json({ error: adminError.message, created }, { status: 500 });
      }
    }
  }

  return Response.json({ created });
});
