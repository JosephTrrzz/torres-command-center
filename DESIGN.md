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

For owner, administrator, operator, employee, member, and viewer roles. It supports workspace switching, operational navigation, notifications, profile controls, and broad information density. The canonical order is Today, Overview, Clients, CRM, Projects, Operations, Inbox, Campaigns, Integrations, Reports, then Settings when permitted.

### Client shell

For the customer/client role. It has a quieter visual treatment and only exposes Today, Onboarding, Projects, Operations, Inbox, and My account. Future client navigation may rename these to Home, Projects, Messages, Documents, Performance, Billing, Support, and Settings only when real routes and permissions exist. Never add dead links to imply unfinished capabilities.

Both shells require a skip link, labeled navigation, deterministic inline SVG icons, visible current location, keyboard focus, and a mobile navigation scrim that dismisses the drawer.

## Shared patterns

- `PageHeader`: eyebrow, one H1, concise description, optional actions.
- `Breadcrumbs`: shell-level orientation; no duplicate page-title breadcrumb.
- `FeedbackBanner`: persistent, accessible success/info/warning/error feedback.
- `StatePanel`: reusable loading, empty, and error presentation with an optional recovery action.
- Buttons: action verbs, stable labels during loading where possible, minimum 44px mobile target.
- Forms: labels remain visible, errors are adjacent and announced, destructive actions are explicit.
- Tables: real table semantics on wide screens; provide intentional horizontal scrolling or a card transformation on narrow screens.
- Status: text plus color; color alone never carries meaning.

## Responsive behavior

- 1440px and wide: fixed sidebar, bounded content, layouts may use two working columns.
- 768px: collapse dense summary rows and working columns without changing task order.
- 390px: one-column flow, 16px side padding, 44px targets, 16px input text, no clipped primary action, no horizontal page overflow.
- Respect `prefers-reduced-motion`; the system remains fully usable with animation disabled.

## Accessibility baseline

Keyboard access, visible focus, semantic headings, accessible names, `aria-current`, error/status announcements, logical DOM order, reduced motion, and usable zoom are required. Decorative SVGs are hidden from assistive technology. Dialogs and popovers must manage focus before they are expanded into more complex workflows.

## Permanent-pattern rule

New permanent visual or interaction patterns must be added here and implemented as reusable components before they are repeated across feature pages.
