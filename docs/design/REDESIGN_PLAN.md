# Redesign plan

## Pre-flight

- **Purpose:** make Torres OS feel like one coherent operating system without rewriting working product behavior.
- **User goal:** staff should find the next action quickly; clients should understand progress and communicate without seeing internal operations.
- **Layout:** one role-aware shell, bounded content, reusable page headers and state feedback, responsive working layouts.
- **Responsive:** verify 390, 768, 1440, and wide widths; preserve DOM order and primary actions.
- **Motion:** subtle control feedback only; honor reduced-motion.
- **Accessibility:** skip link, labeled navigation, visible focus, semantic state announcements, 44px mobile targets, 16px mobile fields.
- **Reuse:** extend `Shell`; add dependency-free primitives before migrating feature pages.
- **Permanent pattern:** tokens, two shell variants, deterministic SVG iconography, page headers, and feedback/state panels are recorded in `DESIGN.md`.

## Navigation model

### Internal IA

1. **Focus:** Today
2. **Relationships:** Overview, Clients, CRM
3. **Delivery:** Projects, Operations
4. **Communication:** Inbox, Campaigns
5. **Evidence:** Integrations, Reports
6. **Administration:** Settings

The first implementation preserves the existing flat order to avoid route or muscle-memory regressions. Labeled sidebar groups can be introduced after usage validation.

### Client IA

Current safe routes remain Today, Onboarding, Projects, Operations, Inbox, and My account. The target language is Home, Projects, Messages, Documents, Performance, Billing, Support, and Settings, but only real, permitted destinations may be shown. Documents, performance, billing, and support should be introduced when their routes and access policies exist.

Global search is not included now. There is no unified, permission-aware search index, and a visual-only search field would misrepresent capability. A navigation command menu may be evaluated after the shell migration.

## Controlled redesign sequence

### Checkpoint A — foundation (this change)

- Install and record design skills
- Create the design contract and research notes
- Add semantic design tokens
- Formalize internal/client shell variants
- Replace platform-dependent nav glyphs with inline SVG
- Add skip link, mobile drawer scrim, labeled navigation, focus and reduced-motion baselines
- Add reusable page header, breadcrumb, feedback, loading, empty, and error components
- Migrate representative high-frequency screens (`Today`, `Clients`) to prove the primitives

### Checkpoint B — operational core

Break CRM, Projects, Operations, and Inbox into testable presentation modules. Consolidate summary cards, split workspaces, list selection, composers, status controls, and confirmations. Verify all staff mutations and client-read-only boundaries.

### Checkpoint C — client journey

Refine onboarding, portal, project status, approvals, messages, and account settings as one client journey. Remove internal language and clearly label staff preview mode.

### Checkpoint D — evidence and administration

Migrate Integrations, Reports, Campaigns, Clients detail, and Settings. Standardize tables, exports, provider errors, permission messaging, and owner-only controls.

### Checkpoint E — regression and accessibility

Keyboard walkthroughs, contrast verification, focus management, reduced motion, 390/768/1440/wide screenshots, role-matrix checks, and full build/test validation.

## Acceptance criteria for this checkpoint

- No production data or infrastructure touched
- Existing route and permission logic retained
- Project-local skills are reproducibly recorded
- Design docs exist and explain conflicts and deferrals
- Shared primitives compile without new runtime dependencies
- Internal and client shells expose only their existing permitted routes
- Navigation icons render consistently on iOS
- Mobile drawer can be dismissed outside the sidebar
- Test, application TypeScript, Functions TypeScript, lint, and production build complete successfully

## Verification record

- 75/75 tests passed across 15 test files.
- Application TypeScript passed with `tsc --noEmit`.
- Cloudflare Functions TypeScript passed with the Functions project configuration.
- ESLint passed using the repository's legacy configuration explicitly; the enclosing workspace has an unrelated flat config that otherwise changes CLI behavior.
- Next.js 15.5.24 production build passed and exported all 16 application routes plus the not-found route.
- The signed-out experience was captured at 390, 768, 1440, and 1728 pixels with no horizontal overflow.
- Authenticated staff and client visual screenshots were not captured because this isolated clone intentionally contains no production credentials. Their route access, shell variant, navigation visibility, and responsive CSS were inspected in source and covered by existing access-control tests. A full role walkthrough should use dedicated non-production test accounts in Checkpoint E.
