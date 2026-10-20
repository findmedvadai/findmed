// Team accounts (Configuración → Usuarios): list, create with a password chosen
// by the admin, change password, enable/disable access, change email.
// Logic in handler.ts.
//
// Auth: admin/superadmin JWT verified in code (verify_jwt = false in
// config.toml, same as triage-admin). Accounts are created through the Auth
// admin API because public sign-up is disabled. No extra secrets. Disabling
// closes sessions through public.revoke_user_sessions (migration
// 20261020120000); without it the ban still applies.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { type AuthAdminApi, type AuthErr, type AuthUser, handleAdminUsers } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Raw = { data: { user: unknown } | null; error: unknown };
const asResult = (r: Raw) => ({
  data: r.data ? { user: (r.data.user ?? null) as AuthUser | null } : null,
  error: (r.error ?? null) as AuthErr | null,
});

const authAdmin: AuthAdminApi = {
  createUser: async (attrs) => asResult(await supabase.auth.admin.createUser(attrs)),
  deleteUser: async (id) => ({ error: (await supabase.auth.admin.deleteUser(id)).error }),
  getUserById: async (id) => asResult(await supabase.auth.admin.getUserById(id)),
  updateUserById: async (id, attrs) => asResult(await supabase.auth.admin.updateUserById(id, attrs)),
};

Deno.serve((req) =>
  handleAdminUsers(req, { supabase, auth: authAdmin, authorize: (r) => requireAdmin(r, supabase) })
);
