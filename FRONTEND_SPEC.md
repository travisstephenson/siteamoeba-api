# SiteAmoeba Frontend Spec

## Architecture
- React + Tailwind + shadcn/ui + wouter (hash routing) + TanStack Query
- Light-mode-first SaaS design with dark toggle
- Teal/emerald primary accent (hsl 160 84% 36%)
- Font: General Sans (body), Inter (fallback), JetBrains Mono (code)
- **Max heading size: text-xl** (SaaS web app rule)
- All API calls via `apiRequest` from `@/lib/queryClient`
- Use `font-variant-numeric: tabular-nums` on all numbers

## Pages & Routes

### 1. Auth Page (`/auth`) — `client/src/pages/auth.tsx`
- Clean centered card with login/register tabs
- Logo at top (inline SVG amoeba mark)
- Login: email + password
- Register: name + email + password
- POST to `/api/auth/login` or `/api/auth/register`
- On success redirect to `/#/`

### 2. Campaigns Overview (`/`) — `client/src/pages/campaigns.tsx`
- Requires auth (GET `/api/auth/me`, redirect to `/auth` if 401)
- Grid of campaign cards (2-3 columns)
- Each card shows: campaign name, URL, visitor count, conversion rate, variant count, status badge
- "New Campaign" button opens a dialog/sheet
- Create campaign form: name, URL, headline CSS selector (optional), subheadline CSS selector (optional)
- Empty state when no campaigns: illustration + CTA

### 3. Campaign Detail (`/campaigns/:id`) — `client/src/pages/campaign-detail.tsx`
- Full campaign dashboard (similar to the v1 headline tester but cleaner)
- Breadcrumb: Campaigns > [name]
- KPI row: Visitors, Conversions, Conv. Rate, Revenue, Credits Used
- Variant sections (headlines + subheadlines) with:
  - Variant cards with stats, toggle, delete, preview button
  - Add variant inline form
  - Monitor icon for live preview (reuse HeroPreview concept but generalized)
- Daily activity chart (simple bar chart)
- Embed code section with copy button
- Stripe webhook URL section

### 4. Billing (`/billing`) — `client/src/pages/billing.tsx`
- Current plan display with usage meter (credits used / limit)
- Plan comparison cards (Free, Starter, Growth, Scale)
- Upgrade button → POST `/api/billing/checkout` → redirect to Stripe
- Manage billing → POST `/api/billing/portal` → redirect to Stripe portal

### 5. Settings (`/settings`) — `client/src/pages/settings.tsx`
- Account info (name, email)
- Current plan summary
- Danger zone: delete account

## App Shell — `client/src/App.tsx`
- SidebarProvider + AppSidebar + main content area
- Sidebar contains:
  - Logo (SiteAmoeba with SVG mark)
  - Campaigns section (list user's campaigns as nav items)
  - Bottom section: Billing, Settings, Logout
- Header bar with breadcrumbs and theme toggle
- Use wouter Router with useHashLocation

## Sidebar — `client/src/components/app-sidebar.tsx`
- Uses shadcn Sidebar components
- Logo at top
- "Campaigns" group label with campaign list
- Each campaign: colored dot + name + visitor count badge
- "+ New Campaign" button
- Bottom: Billing (CreditCard icon), Settings (Settings icon), Logout

## Shared Components
- `client/src/components/theme-toggle.tsx` — Sun/Moon toggle
- `client/src/hooks/use-auth.ts` — auth context/hook that checks `/api/auth/me`

## Design Details
- Cards: white bg, subtle border, small radius
- Buttons: teal primary, ghost secondary
- Numbers use tabular-nums
- Skeleton loaders for loading states
- Smooth transitions on route changes
- Badge colors: green for active, gray for paused, yellow for warning
- Use lucide-react icons exclusively

## CRITICAL Rules
- `<Router hook={useHashLocation}>` wraps `<Switch>` — hook goes on Router, NOT Switch
- Use `apiRequest` for ALL fetch calls — never raw `fetch()`
- Invalidate query cache after mutations
- No localStorage/sessionStorage/cookies for data — only React state + API
- `data-testid` on all interactive and meaningful display elements
