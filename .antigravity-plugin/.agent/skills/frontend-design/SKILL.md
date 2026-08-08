---
name: frontend-design
description: 'MUST USE for any frontend, UI, or web interface implementation. Enforces production-grade visual quality, accessibility, responsive design. Triggers: "build a UI", "frontend", "website", "landing page", "dashboard", any React/Vue/Svelte/HTML component work.'
---

# Professional Frontend Design

This skill transforms generic AI-generated UIs into production-grade, visually distinctive interfaces. It provides a design reasoning framework, industry-aware style selection, and concrete engineering standards.

## Scope Gate — Before Anything Else

Tool selection is governed by `skills/shared/conductor/routing.md` — declare the job (discovery / symbol-edit / docs / output / dispatch / memory) and follow its chain; inspecting these config files is a discovery job.

1. Check: does the project already have a design system, component library, or style guide?
   - Look for: `tailwind.config`, `theme.ts/js`, `tokens.json`, `design-system/`, `styles/`, existing component library (shadcn, MUI, Chakra, etc.)
2. If YES (existing design system):
   - Read and reference the existing system. Do NOT generate a new one.
   - Skip to "Quality Standards" section — apply those standards within the existing design framework.
   - Only generate new design tokens if the existing system has clear gaps for the requested feature.
3. If NO (greenfield):
   - Proceed with full Design System Generation below.

## Design System Generation

Before writing any frontend code, walk through this reasoning framework. The goal is to make deliberate design decisions — not default to generic blue-and-white SaaS templates.

### Step 1: Analyze Requirements

Identify these before choosing any visual direction:
- **Product type** — What category? (SaaS, e-commerce, dashboard, portfolio, etc.)
- **Audience** — Who uses this? (developers, executives, consumers, elderly, children)
- **Platform** — Web, mobile, desktop, or cross-platform?
- **Constraints** — Existing brand guidelines? Required framework? Accessibility level (AA/AAA)?
- **Trust sensitivity** — How much does visual credibility matter? (critical for finance/healthcare, lower for playful apps)
- **Primary user goal** — What does the user come here to do? (scan, convert, explore, act)

### Step 2: Select Design Direction

Use the industry design reference (below; full table in `references/style-catalog.md`) as a starting point, then refine based on project specifics.

Choose explicitly:
- **Style** — The visual language (glassmorphism, brutalism, flat, etc.)
- **Color mood** — Emotional tone (trust blue, energetic orange, calm pastels, dark OLED)
- **Typography mood** — Character (professional, playful, editorial, technical)
- **Key effects** — Signature interactions (hover lifts, parallax, scroll reveals, blur)
- **Density level** — Compact (data-dense, minimal padding), balanced (standard), or spacious (generous whitespace, editorial feel)
- **Visual anchor** — What element draws the eye first? (hero metric, primary CTA, key image, headline)

### Step 3: Define Anti-Patterns

Every product type has styles that actively harm it. Name them explicitly before implementation:
- Finance: playful colors, excessive animation, dark mode by default
- Healthcare: bright neon, motion-heavy, low contrast
- Creative agency: corporate minimalism, generic templates
- Government: ornate design, low contrast, motion effects

### Step 4: Output Design Summary

Before writing code, output a brief design system summary:

```
**Design System**: [Product] — [Style]
**Colors**: [Primary] / [Accent] / [Neutral] / [Semantic]
**Typography**: [Heading font] + [Body font] — [Scale]
**Effects**: [Key interactions]
**Avoid**: [Named anti-patterns]
```

Confirming direction before building prevents rework from a misaligned visual premise.

---

## Distinctiveness Enforcement

Most AI-generated UIs fail here. They're technically correct but visually forgettable — the same blue-and-white SaaS template with rounded cards and a gradient hero. Professional UIs have identity.

The UI must include at least one of these distinctiveness signals:
- **Strong typography decision** — A deliberate scale, weight contrast, or editorial type treatment that gives the interface character
- **Distinctive layout structure** — Something beyond standard stacked sections (asymmetric grid, bento layout, split-screen, offset columns)
- **Controlled visual motif** — A repeating design element (border system, grid pattern, spacing rhythm, accent shape) that ties the interface together
- **Deliberate density choice** — Intentionally compact for data-rich contexts, or intentionally spacious for editorial/luxury feel — not just "default padding"

Avoid these generic patterns:
- Default SaaS layout (hero + 3 feature cards + testimonials + pricing + footer)
- Random gradients without structural purpose
- Card grids where every card has equal visual weight
- "Pleasant but forgettable" — passes review but has no identity

**The test:** If the UI could belong to any startup with a search-and-replace on the logo and copy, it has failed. The design direction chosen in Step 2 should be visible in the final output.

---

## Style, Industry & Layout Selection

Pick a design direction in Step 2 from these catalogs, then adapt to project specifics:
- Style Reference — 25 styles with characteristics, best-for, and when-to-avoid: `references/style-catalog.md`
- Industry Design Reference — recommended style/color/typography/effects/anti-patterns per product category: `references/style-catalog.md`
- Common Page Structures — starting layouts for dashboards, landing pages, admin panels, docs, and more: `references/style-catalog.md`

---

## UI States

Every data-dependent view must handle all five states (loading, error, empty, success, partial/degraded, pending). Shipping only the success state is the single most common quality gap in AI-generated UIs. Full state-by-state table with what-to-show and implementation: `references/engineering-standards.md`.

---

## Quality Standards

### 1. Accessibility (CRITICAL)

- Contrast minimum 4.5:1 normal text, 3:1 large text (WCAG AA)
- `focus-visible` rings 2-4px on all interactive elements — never `outline: none` without a visible replacement
- `alt` text for meaningful images; empty `alt=""` for decorative
- `aria-label` on icon-only buttons and links
- Tab order matches visual order; all interactive elements keyboard-operable
- Sequential heading hierarchy `h1`→`h6`, no level skip; one `h1` per page
- Never convey information by color alone — add icon or text
- `@media (prefers-reduced-motion: reduce)` guard on every animation/transition
- Skip-to-content link on every page
- Semantic HTML: `<nav>`, `<main>`, `<article>`, `<section>`, `<button>` — never `<div onclick>`

### 2. Touch & Interaction (CRITICAL)

- Minimum 44x44px touch targets (Apple HIG) / 48x48dp (Material)
- 8px+ gap between adjacent touch targets
- Never rely on hover alone for primary interactions — use click/tap
- Loading buttons: disable during async operations, show spinner
- Visual tap feedback within 100ms
- `touch-action: manipulation` on interactive elements to remove 300ms tap delay
- Respect safe areas for notch, Dynamic Island, gesture bars
- Cursor: `pointer` on all clickable elements (web)

The remaining standards and supporting patterns are in `references/engineering-standards.md`:
- §3 Performance, §4 Style Consistency, §5 Layout & Responsive, §6 Typography & Color, §7 Animation, §8 Forms & Feedback, §9 Navigation, §10 Charts & Data Visualization
- Frontend-backend integration patterns (loading, optimistic updates, error boundaries, auth, real-time, forms, pagination)
- Dark mode implementation
- Design token scales (radius, elevation)
- Micro-copy & UX writing

---

## Post-Build Fix Priority

When self-reviewing frontend work, fix issues in this order. Earlier items affect everything downstream — fixing color before structure wastes effort.

**structure → hierarchy → spacing → typography → color → interaction → polish**

---

## Pre-Delivery Checklist

Run this verification gate before declaring any frontend work complete:

- [ ] All interactive elements keyboard accessible
- [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 large text)
- [ ] Touch targets ≥44px with 8px+ gaps
- [ ] No horizontal scroll at 375px width
- [ ] `prefers-reduced-motion` media query on all animations
- [ ] Semantic HTML throughout (no `<div onclick>`, proper heading hierarchy)
- [ ] Loading/skeleton states for all async content
- [ ] Error states for all data-dependent views
- [ ] Empty states with helpful message + action
- [ ] Dark mode tested if applicable (contrast, readability, brand)
- [ ] Responsive tested at 375px, 768px, 1024px, 1440px
- [ ] UI does not look like a generic AI template
- [ ] Visual hierarchy is clear within 3 seconds of scanning
- [ ] One clear primary action per major section

---

## Framework & Version Awareness

Before scaffolding any CSS framework, check the project's existing setup:

1. **Existing project** — inspect `package.json` and CSS entry files to detect the current framework and major version (discovery job — see Scope Gate above). Use whatever version is already in use. Do not silently upgrade.
2. **Greenfield project** — default to the latest stable major version of the chosen framework. State the version explicitly before writing any setup code ("Using Tailwind CSS v4.x").
3. **Ambiguous version** — ask the user before writing setup code. Major version differences have breaking setup patterns.
4. **Never mix major version patterns** — v3 config syntax + v4 CSS directives = broken build.

### Tailwind CSS

Read **`tailwind-v4.md`** before writing any Tailwind setup, config, or utility classes for greenfield projects choosing Tailwind or projects where the Tailwind version is unknown. This is a LOAD-BEARING native Read of the bundled file — its v4 patterns must be in context verbatim to write correct Tailwind code, so use the native Read tool (not ctx, which would keep the reference out of context). Training data is biased toward v3; `tailwind-v4.md` has the correct v4 install commands, `@theme` config syntax, renamed class scales, and new features that v3 training will get wrong.

---

## When to Use in Superpowers

- During `.agent/skills/executing-plans/SKILL.md` or `.agent/skills/subagent-driven-development/SKILL.md` when tasks involve UI/frontend
- When the user cares about premium visual quality, brand alignment, or accessibility
- Apply the Design System Generation framework before implementation begins
- Recommend an appropriate stack guided by user constraints (e.g., Next.js + Tailwind + Radix, Svelte + skeleton UI, plain HTML + CSS for simple sites)
- Before declaring frontend work complete, run the Pre-Delivery Checklist and route review through `.agent/skills/requesting-code-review/SKILL.md`

## Supporting References

- `references/style-catalog.md` — Style Reference (25 styles), Industry Design Reference by product category, and Common Page Structures.
- `references/engineering-standards.md` — Quality Standards §3–§10, UI state handling, frontend-backend integration, dark mode, design token scales, and micro-copy.
- `tailwind-v4.md` — Tailwind CSS v4 installation, configuration, class name changes from v3, and new features. Read before any Tailwind work on greenfield or version-unknown projects.
