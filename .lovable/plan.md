

# Phase 1A: Authentication System + Dashboard Layouts

## Overview
Build the login system, auth context, role-based route protection, and sidebar-based dashboard layouts for Doctor and Admin roles. After this step you will have a working login page, protected dashboards with navigation, and placeholder pages for each section.

---

## 1. Auth Context and Hook

**File: `src/hooks/useAuth.tsx`**

Create an auth context provider that:
- Listens to `onAuthStateChange` (set up BEFORE calling `getSession`)
- Stores the current Supabase session/user
- Fetches the user's role from `user_roles` table and `doctor_id` from `users` table
- Exposes: `user`, `session`, `role`, `doctorId`, `loading`, `signOut`

---

## 2. Login Page

**File: `src/pages/Login.tsx`**

- Clean login form with email + password (FindMed branding)
- FindMed logo/title at the top in Azul #123D74
- Rosa CTA button for "Iniciar Sesion"
- Error messages displayed inline
- On success: redirect based on role (doctor -> /doctor/agenda, admin/superadmin -> /admin/calendario)
- Loading/submitting states on button

---

## 3. Route Protection Component

**File: `src/components/ProtectedRoute.tsx`**

- Wraps routes that require authentication
- Accepts `allowedRoles` prop (e.g., `['admin', 'superadmin']`)
- Shows loading spinner while checking auth
- Redirects to `/login` if not authenticated
- Redirects to appropriate dashboard if role doesn't match

---

## 4. Dashboard Layouts with Sidebar

### Admin Layout
**File: `src/components/layouts/AdminLayout.tsx`**

Sidebar navigation with items:
- Calendario (`/admin/calendario`)
- Reservas (`/admin/reservas`)
- Doctores (`/admin/doctores`)
- Catalogos (`/admin/catalogos`)
- Inbox (`/admin/inbox`)

Uses `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarTrigger` from the existing sidebar component. Header bar with FindMed branding and user menu (sign out).

### Doctor Layout
**File: `src/components/layouts/DoctorLayout.tsx`**

Sidebar navigation with items:
- Agenda (`/doctor/agenda`)
- Configuracion (`/doctor/configuracion`)
- Por Completar (`/doctor/por-completar`) -- with red badge
- Inbox (`/doctor/inbox`)

Same sidebar pattern, with doctor's name displayed.

---

## 5. Placeholder Pages

Create minimal placeholder pages so navigation works:

**Admin pages:**
- `src/pages/admin/Calendario.tsx`
- `src/pages/admin/Reservas.tsx`
- `src/pages/admin/Doctores.tsx`
- `src/pages/admin/Catalogos.tsx`
- `src/pages/admin/Inbox.tsx`

**Doctor pages:**
- `src/pages/doctor/Agenda.tsx`
- `src/pages/doctor/Configuracion.tsx`
- `src/pages/doctor/PorCompletar.tsx`
- `src/pages/doctor/DoctorInbox.tsx`

Each page shows a title card with "Coming soon" content so the layout is visible.

---

## 6. Updated Routing

**File: `src/App.tsx`**

Update to include:
- `/login` -- Login page
- `/admin/*` routes wrapped in `ProtectedRoute` (roles: admin, superadmin) with `AdminLayout`
- `/doctor/*` routes wrapped in `ProtectedRoute` (roles: doctor) with `DoctorLayout`
- `/reserva` and `/gestionar` -- public patient routes (placeholder for now)
- `/` redirects to `/login`

---

## 7. Index Page Update

**File: `src/pages/Index.tsx`**

Redirect to `/login` since the root page should send users to authenticate.

---

## Files Created/Modified Summary

| Action | File |
|--------|------|
| Create | `src/hooks/useAuth.tsx` |
| Create | `src/pages/Login.tsx` |
| Create | `src/components/ProtectedRoute.tsx` |
| Create | `src/components/layouts/AdminLayout.tsx` |
| Create | `src/components/layouts/DoctorLayout.tsx` |
| Create | `src/pages/admin/Calendario.tsx` |
| Create | `src/pages/admin/Reservas.tsx` |
| Create | `src/pages/admin/Doctores.tsx` |
| Create | `src/pages/admin/Catalogos.tsx` |
| Create | `src/pages/admin/Inbox.tsx` |
| Create | `src/pages/doctor/Agenda.tsx` |
| Create | `src/pages/doctor/Configuracion.tsx` |
| Create | `src/pages/doctor/PorCompletar.tsx` |
| Create | `src/pages/doctor/DoctorInbox.tsx` |
| Modify | `src/App.tsx` |
| Modify | `src/pages/Index.tsx` |

---

## Technical Notes

- Auth state listener uses `onAuthStateChange` set up BEFORE `getSession()` to avoid race conditions
- Roles are fetched from `user_roles` table via `has_role` security definer function pattern -- never stored in localStorage
- The `users` table provides the `doctor_id` mapping for doctor-role users
- Sidebar uses the existing `src/components/ui/sidebar.tsx` component with `NavLink` for active route highlighting
- All text in Spanish to match the Mexican medical context

