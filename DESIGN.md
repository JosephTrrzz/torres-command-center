# Torres OS Design System

## Product character

Torres OS is a calm, luxury-grade operating system for a service business. It should feel established, precise, discreet, trustworthy, and useful under pressure. Luxury here means material restraint, excellent typography, generous composition, and confidence—not decoration, excess motion, or low-density marketing layouts.

The public Torres & Co. website is a separate product surface. The command center may share brand assets, but it must not import public-site navigation, conversion patterns, or decorative sections.

## Principles

1. **Clarity before density.** Group related controls, reveal advanced operations progressively, and give every screen one obvious starting point.
2. **Role truth.** Staff and clients use distinct shells. Never reveal internal navigation, operational controls, or another tenant’s data to a client.
3. **Real state.** Loading, empty, success, warning, and error states must explain what happened and what the user can do next. Never invent metrics or records.
4. **Operational continuity.** Existing routes, URLs, auth checks, RLS boundaries, and API contracts are product behavior, not implementation details.
5. **Restrained polish.** Motion is brief and functional. No cinematic entrance sequences, novelty cursors, decorative gradients, or animation dependencies.

## Visual language

- Primary: heritage navy `#132238`
- Accent: antique brass `#a57d3d`
- Official logo source colors: Torres blue `#122137` and Torres gold `#b08d57`. These are reserved for faithful rendering of the supplied brand mark; interface surfaces continue to use the semantic primary and accent tokens above.
- Canvas: warm ivory `#f7f5f0`
- Surface: white `#ffffff`
- Text: charcoal `#242424`
- Muted text: `#6d6a64`
- Border: `#e5e0d7`
- Success: `#607946`; warning: `#8d671f`; danger: `#9d4938`

Use semantic CSS variables from `app/design-foundation.css`; feature CSS should consume the semantic tokens rather than introduce new brand colors. White and parchment surfaces sit on an ivory canvas with hairline borders. Use tonal contrast before shadows; elevation is reserved for menus, drawers, and selected working surfaces. Brass is an accent, not a large-area fill.

## Typography

Manrope is the interface family. An editorial serif stack—`Iowan Old Style`, Baskerville, Georgia, then serif—is reserved for page titles and major moments. DM Mono is reserved for eyebrows, compact metadata, IDs, timestamps, and numerical labels. Titles use tight tracking and sentence case. Body copy should stay between 45 and 72 characters per line where practical. Do not use tiny text to force density: interactive text and form values must remain legible, and mobile form controls use at least 16px text.

## Spacing and shape

Use the spacing tokens (`--space-1` through `--space-6`) and a base rhythm of 4px. Controls use `--radius-control`; cards use `--radius-card`; large workspaces may use 20–22px. Avoid nested cards when spacing or a divider can communicate the same grouping.

## Application shells

### Internal shell

For owner, administrator, operator, employee, member, and viewer roles. It supports workspace switching, operational navigation, notifications, profile controls, and broad information density. The canonical order is Today, Overview, Clients, CRM, Projects, Operations, Schedule, Inbox, Campaigns, Integrations, Reports, then Settings when permitted.

### Client shell

For the customer/client role. It has a quieter visual treatment and exposes Today, Onboarding, Projects, Operations, Inbox, Reports, and My account through the plain-language labels Home, Setup, Projects, Services, Messages, Performance, and Account. Performance is the tenant-scoped live Reports workflow; it is not a decorative or dead destination. Never add dead links to imply unfinished capabilities.

Both shells require a skip link, labeled navigation, deterministic inline SVG icons, visible current location, keyboard focus, and a mobile navigation scrim that dismisses the drawer.

Header popovers are viewport-bounded floating surfaces. They must render above page content, keep their heading and footer visible, and scroll only their internal list when content is long. Opening one shell menu closes the others; Escape dismisses every open shell menu.

Shell identity always represents the signed-in person, never the active organization. The sidebar and account menu use `profiles.full_name`, with a readable email-derived fallback only when that field is empty. Owners and administrators edit this value in Settings; clients edit it from Account. Both surfaces use the same reusable identity editor and protected self-profile API. Portraits are cropped into a fixed, non-shrinking avatar so long names cannot distort them; the current browser-local portrait remains a device preference until a storage-backed media workflow is introduced.

## Shared patterns

- `PageHeader`: eyebrow, one H1, concise description, optional actions.
- `Breadcrumbs`: shell-level orientation; no duplicate page-title breadcrumb.
- `FeedbackBanner`: persistent, accessible success/info/warning/error feedback.
- `StatePanel`: reusable loading, empty, and error presentation with an optional recovery action.
- Buttons: action verbs, stable labels during loading where possible, minimum 44px mobile target.
- Forms: labels remain visible, errors are adjacent and announced, destructive actions are explicit.
- Tables: real table semantics on wide screens; provide intentional horizontal scrolling or a card transformation on narrow screens.
- Status: text plus color; color alone never carries meaning.
- Integration control: provider cards always name their scope (`This client`, `Agency-wide`, or `Platform`), pair status color with text, and place destructive disconnect actions behind explicit confirmation. Health history is durable and server-owned; browser-local readiness is not a valid provider state. Automated checks show their next run and trigger source. One failed check is recorded without noise; two consecutive failures open one durable administrator alert, and the first later success resolves it with a recovery notice.

## Responsive behavior

- 1440px and wide: fixed sidebar, bounded content, layouts may use two working columns.
- 768px: collapse dense summary rows and working columns without changing task order.
- Sidebar-aware workspaces begin collapsing around 1180px because the usable content column is narrower than the browser viewport. Page titles and large selectors stack before their combined minimum widths collide.
- 390px: one-column flow, 16px side padding, 44px targets, 16px input text, no clipped primary action, no horizontal page overflow.
- Respect `prefers-reduced-motion`; the system remains fully usable with animation disabled.

## Accessibility baseline

Keyboard access, visible focus, semantic headings, accessible names, `aria-current`, error/status announcements, logical DOM order, reduced motion, and usable zoom are required. Decorative SVGs are hidden from assistive technology. Dialogs and popovers must manage focus before they are expanded into more complex workflows.

## Motion and loading

Motion communicates state and continuity; it is never decoration. Use the CSS-native timing tokens from `app/design-foundation.css`: micro feedback at 150ms, component changes at 220ms, dialogs at 280ms, and route/content reveals at 320ms. The standard luxury easing is `cubic-bezier(.22,1,.36,1)`. Static cards do not lift on hover. Interactive controls may use a one-pixel press or directional response when that movement clarifies the action.

Client-fetched routes keep the application shell mounted and render `LoadingRegion` inside the content area. The skeleton is delayed 180ms so fast requests do not flash, and targets at least 360ms of visibility when the owning view remains mounted. When an initial page request remains unresolved for 1.5 seconds, the region may add the compact, non-looping signature mark over the layout-shaped skeleton with honest status copy; it disappears as soon as real content arrives. Real content always wins: never delay a completed response merely to finish an animation, and never replace already-visible content during a background refresh. Use the small `ButtonLoader` or `RefreshIndicator` for refreshes and mutations while preserving the original button label.

Skeletons use warm ivory and parchment surfaces, a hairline brass-tinted border, and a low-contrast champagne shimmer. Their geometry must resemble the destination UI: metric blocks for summaries, rows for tables and lists, paired panes for CRM and Inbox, and structured fields for settings. They may not contain fake names, values, or records. Loading regions use `aria-busy` and an announced text label while all visual placeholders remain hidden from assistive technology.

Authentication checking uses `BrandedAppLoader` as the quiet, non-looping signature-mark state. A submitted sign-in or account activation replaces the form with the animated signature while the real authentication request is pending, then carries that completed mark across the route boundary and releases it upward over the ready workspace without replaying the fill. Once an authenticated session is confirmed outside that sign-in handoff, the full `TorresLogoLoader` is eligible only under the first-entry rule below and uses a restrained 1.42-second compositional hold so its final light pass completes before the viewport release; reduced-motion users receive no artificial hold. Neither startup treatment may appear for ordinary route navigation or background refreshes. Loaded content may use a 220ms opacity and three-pixel vertical reveal. Do not cascade item entrances, animate charts for decoration, or add an animation dependency.

The signature `TorresLogoLoader` is the approved default for first authenticated entry in each browser session. It uses optimized layers derived from the official mark, preserves its exact proportions and source colors, and plays one uninterrupted sequence only: the dark loading surface appears before workspace content, the faint outline and bottom-up blue and gold fills complete, one diagonal light pass settles into a brief full-color hold, and only then does the surface release upward. Loaded content wins through one composed 560ms upward viewport release: the fixed loader surface moves beyond the top edge while the ready screen is revealed from the bottom and settles upward beneath it. Authenticated reload must preserve the same loader instance while the session is checked so the mark never resets or flashes. Subsequent route navigation does not replay the signature sequence. It never loops, spins, reports fake progress, or replaces skeletons and inline indicators for routine work. Dark and light appearances, fixed responsive sizes, concise `role="status"` copy, an actionable recovery state, and a reduced-motion opacity treatment are required. The standalone concept route remains available as a controlled motion reference and replay surface.

Under `prefers-reduced-motion: reduce`, shimmer, spinners, progress-line movement, and content reveals become static immediately. Loading meaning must remain clear through shape and text. Error and empty states remain separate components and must never be styled as loading placeholders.

Correct: retain a loaded inbox thread while a small refresh indicator reports a background poll. Incorrect: blank the thread, show a full-page spinner, or change the Refresh label width while polling.

## Permanent-pattern rule

New permanent visual or interaction patterns must be added here and implemented as reusable components before they are repeated across feature pages.

### Private calendar connection

Calendar subscriptions are presented as compact connection panels beside the real schedule they export. The panel must name the provider, explain refresh behavior, distinguish the private subscription URL from ordinary navigation, and provide an explicit revoke action. A raw subscription URL is shown only after creation in the current browser session; it is not persisted in browser storage. Client feeds contain only client-visible service work, while staff feeds may include internal CRM appointments and task deadlines.

Calendar subscriptions are staff tools. Client schedules use an event-specific `Add to calendar` menu instead: Google Calendar, Outlook Calendar, and a standards-based `.ics` download for Apple Calendar or another compatible app. Each action exports only the selected client-visible appointment, never reveals a subscription URL, and requires no calendar-account connection. Canceled events are not exportable. The action remains attached to the appointment row and becomes a full-width 44px control on mobile.

### Agency Schedule

Schedule is the staff-facing, cross-client reading surface for the existing Operations calendar. It aggregates authorized service jobs, CRM appointments, and task deadlines without creating a second event store. Month, week, and agenda views share one restrained toolbar with Today, period navigation, search, client, category, and local-time-zone context. View, date, and filters persist in the URL. Selecting an event opens a viewport-bounded detail drawer and routes edits back to the owning client’s Operations workspace. On mobile, agenda is the default and dense calendar layouts collapse into a readable chronological list. Client users continue to see only their own client-visible schedule inside Services.

## Private Office production mode

Private Office is the approved presentation system for authenticated client roles. It is a role-aware layer inside Torres OS—not a separate application—and therefore retains the same routes, Supabase records, APIs, permission checks, and workflows as the internal command center.

The client workspace selector is a compact, sidebar-bounded access panel rather than a floating desktop menu. It names the current client organization, explains the client-only boundary, and may offer a secure teammate invitation. A teammate invitation always grants the `client` role in the exact active client organization; it never grants agency access. Onboarding controls use full-width, clearly bounded fields with a minimum 48px control height and a minimum 108px textarea so saved business information remains easy to scan and edit.

The customer-facing Private Office may use a low-contrast, repeating security-print pattern built only from the official Torres & Co. Technology monogram artwork. The repeat tile keeps generous transparent space around a reduced-size emblem so the background reads as quiet stationery rather than wallpaper. The pattern is rendered in restrained metallic gold over ivory, remains behind readable content, and scales responsively without introducing a separate brand mark. On dark portfolio surfaces, the same official artwork becomes the primary gold emblem. Third-party artwork and literal copies of reference motifs are never used.

The client shell uses a slimmer midnight-navy navigation rail, restrained brass line work, editorial page titles, and plain-language labels: Home, Setup, Projects, Services, Messages, Performance, and Account. Labels may differ from the internal route names, but their destinations and access rules must remain canonical. Performance uses the existing tenant-scoped live report API and RLS-constrained client query. Do not add search, billing, support, or documents controls until a real permitted workflow exists behind each control.

The client Home route is `/today/` and is the default customer landing page. It begins with three pieces in this order: a personalized arrival, a real account-standing statement, and a reusable `PrivateOfficePortfolioPanel` paired with one contextual next action. The portfolio panel represents a service relationship—not a payment card—and may show only real client, account, contact, service, and status values. Missing optional values are omitted or described honestly. Recent tenant-scoped notifications follow as a quieter “What changed” chapter. Account remains the editable client record rather than duplicating the Home experience.

On screens up to 680px, the client shell adds a fixed five-destination bottom navigation for Home, Projects, Messages, Performance, and Account. Setup and Services remain available in the full drawer. The bottom navigation mirrors existing routes and permissions, preserves a visible current state, and reserves enough content padding that it never covers controls.

Internal users retain the denser operational shell. Projects and reports may use the same editorial typography and material system, but management controls remain compact and available only where the existing permission model allows them. Mobile client mode uses the same content order and permissions, with a dark branded header and one-column composition; it is not a scaled desktop mockup.

Reporting must pair every headline metric with its provider, plain-language definition, complete date window, and previous-period state. Trend language may only appear when stored daily observations exist for the comparison period; otherwise the interface says that the period is still collecting. Never infer missing days as performance decline or present live totals as an immutable snapshot.

Authentication is the shared entrance for every role. Its editorial Private Office introduction sits beside the existing form at desktop widths and precedes it on smaller screens. It does not change account activation, return-path validation, credential handling, or role-based routing.
