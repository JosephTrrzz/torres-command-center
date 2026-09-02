# Design reference sources

Reviewed September 2, 2026. External sources are inspiration and quality checks, not permission to replace existing product behavior.

| Source | Version reviewed | Applied | Explicitly not applied |
|---|---|---|---|
| [Taste Skill](https://www.tasteskill.dev/) | Site current on review date | Anti-generic hierarchy, intentional composition, strong visual authorship | Cinematic landing-page behavior and motion-heavy presentation |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | `ccbc15639c97057cbfcf32ecebc38ef716e4bb37` | Audit-first redesign method; installed `gpt-taste` and `redesign-existing-projects` locally | GSAP dependency, random styling, novelty effects, public-site AIDA flow inside an operations app |
| [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) | Current guidance fetched on review date | Keyboard flow, visible focus, 44px mobile targets, 16px mobile form text, reduced motion, stable loading feedback, semantic controls | Vercel brand styling |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `063bee94c3f4df8453406c830b0a7df0f2860278` | Installed `web-design-guidelines` locally; used as the accessibility and interaction checklist | No runtime dependency added |
| [awesome-design-md](https://github.com/voltagent/awesome-design-md) | Repository current on review date | Design-system documentation structure and machine-readable intent | No copied product identity or components |
| [OpenCode DESIGN.md](https://getdesign.md/opencode.ai/design-md) | Page current on review date | Durable design-contract idea: principles, tokens, components, states, responsive rules | No copied palette or IA |

## Local skill installation

The project-local files are under `.agents/skills/` and locked in `skills-lock.json`:

- `gpt-taste`
- `redesign-existing-projects`
- `web-design-guidelines`

The first skill’s animation-forward defaults conflict with this product’s operational and accessibility requirements. Its hierarchy and anti-generic critique are retained; its motion and dependency recommendations are not.
