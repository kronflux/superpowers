# Frontend Design — Engineering Standards (detail)

Detailed engineering standards referenced by `SKILL.md`. The CRITICAL quality standards (§1 Accessibility, §2 Touch & Interaction) live in `SKILL.md`; the remaining numbered standards §3–§10 and the supporting pattern sections are below.

## Quality Standards §3–§10

### 3. Performance (HIGH)

- Images: WebP/AVIF format, responsive `srcset`/`sizes`
- `loading="lazy"` on all below-fold images
- Declare `width`/`height` or `aspect-ratio` on images/media to prevent CLS
- `font-display: swap` or `optional`; preload only critical fonts
- Lazy load non-hero components via dynamic import / route splitting
- Reserve space for async content — no layout jumps (CLS < 0.1)
- Virtualize lists with 50+ items (react-virtual, tanstack-virtual)
- Skeleton screens or shimmer for operations exceeding 300ms
- Critical CSS inlined or early-loaded for above-the-fold content

### 4. Style Consistency (HIGH)

- Match style to product type using the Industry Reference Table
- SVG icon libraries (Heroicons, Lucide, Phosphor) — never emoji as icons
- One icon set and visual language across the entire product
- Consistent elevation/shadow scale for cards, sheets, modals
- Design light and dark variants together — test contrast separately
- One primary CTA per screen; secondary actions visually subordinate
- Effects (shadows, blur, radius) must align with chosen style
- Avoid "card spam" — not everything needs a container. Use spacing and typography to group related content instead of wrapping everything in bordered boxes
- Visual hierarchy must not rely only on color — use size, weight, spacing, and position to establish importance

### 5. Layout & Responsive (HIGH)

- Mobile-first: base styles target small screens, `min-width` media queries scale up
- `<meta name="viewport" content="width=device-width, initial-scale=1">` — never disable zoom
- Systematic breakpoints: 375 / 768 / 1024 / 1440
- Minimum 16px body text on mobile (prevents iOS auto-zoom)
- Line length: 35-60 chars mobile, 60-75 chars desktop (`max-width: 65ch`)
- No horizontal scroll on mobile
- 4pt/8dp spacing rhythm throughout; consistent spacing scale
- `max-width` container on desktop (e.g., `max-w-7xl`)
- Use `min-h-dvh` instead of `100vh` on mobile (accounts for browser chrome)
- Consistent `z-index` scale: 0 / 10 / 20 / 40 / 100 / 1000
- Layout should adapt hierarchy on different breakpoints, not just stack columns — what's a sidebar on desktop might become a bottom sheet on mobile, not just a collapsed column

### 6. Typography & Color (MEDIUM)

- Design tokens as CSS custom properties: `--color-primary`, `--spacing-md`, `--font-size-base`
- Semantic color tokens (`primary`, `secondary`, `error`, `surface`, `on-surface`) — no raw hex in components
- Fluid typography with `clamp()`: e.g., `clamp(1rem, 0.5rem + 1.5vw, 1.25rem)`
- Consistent type scale: 12 / 14 / 16 / 18 / 24 / 32 / 48
- Line-height 1.5-1.75 for body text; 1.1-1.3 for headings
- Font weight hierarchy: bold headings 600-700, regular body 400, medium labels 500
- Dark mode: desaturated/lighter tonal variants — never just invert colors
- Tabular/monospaced figures for data columns, prices, timers

### 7. Animation (MEDIUM)

- Micro-interactions: 150-300ms; complex transitions: ≤400ms; never >500ms
- Animate only `transform` and `opacity` — never `width`, `height`, `top`, `left`
- `ease-out` for entering elements, `ease-in` for exiting
- Exit animations ~60-70% of enter duration for responsive feel
- Stagger list/grid item entrance: 30-50ms per item
- Prefer spring/physics-based curves for natural motion feel
- All animations must be interruptible by user interaction
- Maximum 1-2 animated elements per view at once
- Skeleton/progress indicator for any load exceeding 300ms

### 8. Forms & Feedback (MEDIUM)

- Visible `<label>` per input — never placeholder-only labels
- Error messages below the related field, not only at form top
- Validate on blur, not on each keystroke
- Required fields: asterisk indicator + `required` attribute
- Helper text below complex inputs (persistent, not tooltip-only)
- Disabled state: opacity 0.38-0.5 + `cursor: not-allowed` + semantic `disabled`
- Progressive disclosure: reveal complex options only when relevant
- Confirm before destructive actions (delete, discard, overwrite)
- Auto-save for long forms to prevent data loss
- Toast auto-dismiss 3-5s; use `aria-live="polite"` for screen readers
- Error messages must state cause + how to fix (not just "Invalid input")

### 9. Navigation (HIGH)

- Bottom nav: max 5 items, each with icon + text label
- Back behavior must preserve scroll position and filter/input state
- All key screens reachable via deep link / URL
- Current location visually highlighted in navigation
- Modals/sheets: clear close/dismiss affordance; swipe-down on mobile
- Large screens (≥1024px): prefer sidebar nav; small screens: bottom/top nav
- Never mix Tab + Sidebar + Bottom Nav at the same hierarchy level
- Route change: move focus to main content region for screen readers
- Drawer/sidebar for secondary navigation, not primary actions

### 10. Charts & Data Visualization (LOW)

- Match chart type to data: trend→line, comparison→bar, proportion→pie/donut
- Accessible color palettes + pattern/texture supplements (not color-only)
- Provide data table alternative for screen readers
- Legend visible near chart, not below scroll fold
- Tooltips on hover (web) / tap (mobile) showing exact values
- Responsive: simplify on small screens (horizontal bar, fewer ticks)
- Skeleton/shimmer placeholder while chart data loads
- No pie chart for >5 categories — switch to bar
- All interactive chart elements keyboard-navigable
- `aria-label` summary describing the chart's key insight

---

## UI States

Every data-dependent view must handle all five states. Shipping only the success state is the single most common quality gap in AI-generated UIs.

| State | What to Show | Implementation |
|---|---|---|
| **Loading** | Skeleton shimmer matching content layout — never a blank screen or spinner alone | Skeleton components that mirror the final layout shape |
| **Error** | What went wrong + how to fix it + retry action | Error boundary (React) or error component; include retry button |
| **Empty** | Helpful message + primary action to populate | Illustration optional; clear CTA ("Create your first project") |
| **Success** | The actual content, fully interactive | Default state — but don't forget the other four |
| **Partial / Degraded** | Available data + indicator for what's missing or stale | "Last updated 5m ago" badge, greyed-out sections, retry for failed parts |
| **Pending** | User-triggered async action in progress | Inline spinner or progress indicator on the triggering element, disable re-trigger, revert UI on failure |

---

## Frontend-Backend Integration

When building a tool with both backend and frontend, these patterns determine perceived quality:

- **API loading**: Every fetch must show loading state immediately, not after a delay. Use `useSWR`, `react-query`, or equivalent for cache + revalidation.
- **Optimistic updates**: For user-initiated mutations (toggle, delete, reorder), update the UI immediately and roll back on failure. Waiting for the server round-trip feels sluggish.
- **Error boundaries**: Wrap route segments in error boundaries so one failed API call doesn't crash the entire page. Show a localized error with retry, not a white screen.
- **Auth flow**: Login/signup → redirect to intended destination (not always home). Show auth state in nav (avatar/menu). Handle token expiry gracefully (refresh silently, prompt re-login only when needed).
- **Real-time updates**: For dashboards/chat, use WebSocket or SSE with reconnection logic. Show connection status indicator. Degrade gracefully to polling if WS fails.
- **Form submissions**: Disable submit button during request, show inline progress, display success confirmation or inline errors. Never navigate away without confirming unsaved changes.
- **Pagination / infinite scroll**: Show count ("1-25 of 342"), maintain scroll position on back-nav, use cursor-based pagination for real-time data.

---

## Dark Mode Implementation

When the project needs dark mode, implement it properly — not as an afterthought. But first, evaluate whether dark mode is actually appropriate for the product. Not every interface benefits from it — light mode is often the right default for content-heavy, trust-sensitive, or general-audience products. Do not add dark mode just because it's trendy.

- Use CSS custom properties for all colors: `--color-bg`, `--color-text`, `--color-surface`
- Apply via `prefers-color-scheme` media query for system default + class toggle for user override
- Dark mode is NOT inverted colors — use desaturated, lighter tonal variants with adjusted contrast
- Shadows become less visible in dark mode — use border or elevated surface colors instead
- Test all semantic colors (error red, success green, warning amber) against dark backgrounds
- Store user preference in `localStorage`; respect system preference as default

---

## Design Token Scales

Beyond color and spacing tokens (covered in Quality Standards §6), define these additional token scales to prevent ad-hoc values:

- **Radius scale** — Border radius values tied to the design direction (e.g., `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 16px`). A brutalist design uses sharp radii; glassmorphism uses larger values.
- **Elevation scale** — Shadow definitions for consistent depth (e.g., `--shadow-sm`, `--shadow-md`, `--shadow-lg`). These must match the chosen style — flat design uses none, neumorphism uses dual light/dark shadows.

---

## Micro-Copy & UX Writing

Words are UI. Bad copy makes good design feel broken.

- **Button labels**: Use specific verbs ("Save changes", "Create project", "Send invite") — never generic ("Submit", "OK", "Click here")
- **Error messages**: State the cause + the fix ("Email is already registered — try logging in instead") — never just "Invalid input" or "Error occurred"
- **Empty states**: Tell the user what this space is for + how to fill it ("No projects yet. Create your first project to get started.")
- **Confirmation dialogs**: Name the destructive action ("Delete 3 files permanently?") — never "Are you sure?"
- **Loading text**: Describe what's happening if it takes >3s ("Loading your dashboard..." not just a spinner)
- **Success feedback**: Confirm what happened ("Project created" not "Success")
- **Placeholder text**: Use realistic examples ("jane@company.com") not instructions ("Enter your email")
