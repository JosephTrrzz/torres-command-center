# UX audit

## Detected stack and boundaries

- Next.js 15.5 App Router with static export and trailing-slash routes
- React 18 and TypeScript 5.6
- Cloudflare Pages Functions for server operations
- Supabase for authentication and tenant-scoped data with RLS
- Vanilla global CSS; no component library or CSS framework
- Vitest plus separate application and Functions TypeScript checks

The repository is not greenfield. Route contracts, client query parameters, preview modes, API functions, auth redirects, and role checks are existing behavior. The public website and command center remain separate deployments.

## Route and screen inventory

| Route | Audience | Primary job | Main UX risk | Priority |
|---|---|---|---|---|
| `/login/` | all signed-out users | sign in or activate account | role tabs imply a choice but permissions remain server-derived; feedback density | P1 |
| `/today/` | staff and clients | see immediate priorities | staff/client intent is mixed; loading was plain text | P0 addressed in foundation |
| `/` | staff | portfolio overview | legacy page patterns and metrics differ from newer modules | P1 |
| `/clients/` | staff | manage client accounts and activation | form, feedback, card actions compete; repeated floating links | P1 partial foundation |
| `/clients/detail/` | staff | inspect one client | query-driven detail and people actions need stronger hierarchy | P1 |
| `/crm/` | staff | triage and progress leads | high density; selection and composer states need responsive review | P0 |
| `/projects/` | staff and clients | track scope and delivery | role-specific actions coexist in one large component | P0 |
| `/operations/` | staff and clients | schedule and approve service delivery | very long page; many nested panels and forms | P0 |
| `/inbox/` | staff and clients | communicate securely | 631-line screen, message state complexity, attachments, live refresh | P0 |
| `/campaigns/` | staff | create and monitor campaigns | dense split workspace; unfinished channels must remain explicit | P1 |
| `/onboarding/` | clients and staff preview | complete client profile | long multi-step form and dual mode | P0 |
| `/portal/` | clients; staff preview | client home and evidence | overloaded dashboard with preview boundary | P0 |
| `/integrations/` | staff | map provider resources | provider errors and readiness compete with selection | P1 |
| `/reports/` | staff | review and export evidence | table responsiveness and export-state feedback | P1 |
| `/settings/` | owner | workspace administration | broad settings and admin functions on one screen | P0 |
| `not-found` | all | recover navigation | does not use full shared recovery pattern | P2 |

## Shared findings ranked by severity

### P0 — blocks trust, access, or core task clarity

1. Internal and client experiences share one shell implementation without an explicit shell contract. Role checks exist and are retained, but visual/IA intent was implicit.
2. Loading, empty, error, and success treatments vary by route; some are plain paragraphs, reducing confidence during remote operations.
3. The largest screens (`inbox`, `crm`, `operations`, `projects`) mix fetch state, mutation state, forms, and rendering in single client components. This raises regression risk and makes consistent responsive behavior difficult.
4. Mobile navigation had no scrim or outside-dismiss action. Form text frequently fell below 16px, risking iOS zoom and poor legibility.

### P1 — materially slows frequent work

5. Page headers are duplicated across nearly every route with small markup and spacing differences.
6. Navigation used Unicode glyphs whose rendering varies by platform. Deterministic SVG icons are now foundational.
7. Raw visual values and route-specific micro-patterns dominate `ui-enhancements.css`; semantic meaning is difficult to audit.
8. Several desktop working layouts use sticky panels, fixed column widths, and internal scroll regions. Each requires 768px and 390px verification.
9. Tables and report exports have no single responsive contract.
10. Workspace switching and notification popovers use menu/dialog semantics but do not yet provide full focus trapping or Escape handling.

### P2 — polish and consistency

11. Copy alternates among customer, client, company, account, and workspace where one domain term would be clearer.
12. Repeated arrows and compact mono labels introduce visual noise when too many actions are adjacent.
13. Architecture documentation says Next.js 14 while the package is Next.js 15.5.24.
14. Global Google Fonts import is render-blocking and adds an external runtime dependency; self-hosting can be evaluated later.

## Component and pattern inventory

Existing reusable components: `Shell`, `BrandSelect`, `ClientCard`, `ClientProfileForm`, `CustomerAccountPanel`, `OnboardingStatusPanel`, `PeoplePanel`, and `ProfilePictureEditor`.

New foundation components: `AppIcon`, `Breadcrumbs`, `PageHeader`, `FeedbackBanner`, and `StatePanel`. These are intentionally dependency-free and compatible with static export.

Repeated patterns to consolidate next: metric summary cards, split workspaces, expandable composers, status pills, selectable lists, confirmation dialogs, file rows, activity timelines, and query-parameter client selectors.

## Role visibility matrix

| Capability | Owner/admin | Operator/employee/member | Viewer | Client/customer |
|---|:---:|:---:|:---:|:---:|
| Today and assigned work | yes | yes | read | client-only summary |
| Portfolio overview | yes | yes | read | no |
| Client records and people | manage | manage as permitted | read | own account only |
| CRM and campaigns | manage | operate | read if authorized | no |
| Projects and operations | manage | operate | read | own records and approvals |
| Shared inbox | manage | operate | read if authorized | own conversations |
| Integrations and reports | manage | operate/read | read | summarized evidence only |
| Settings and access control | owner only | no | no | own account settings only |
| Cross-client switching | yes | assigned clients | assigned clients | no |

This matrix describes product intent; enforcement remains in current auth, API authorization, and Supabase RLS. UI visibility must never be treated as the security boundary.

## Responsive review targets

- 390px: mobile drawer, form zoom, stacked actions, message bubbles, tables, sticky panels
- 768px: split-workspace collapse and summary grid balance
- 1440px: standard staff workflow and client preview
- 1728px+: bounded content and useful density without stretched line lengths

## Deferred because this is a foundation checkpoint

No route removal, workflow redesign, data-model change, auth change, API change, RLS change, environment change, search backend, or production migration is included. Full focus-managed popovers and route-by-route component decomposition belong to the next checkpoints.
