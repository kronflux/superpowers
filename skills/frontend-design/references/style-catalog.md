# Frontend Design — Style, Industry & Layout Catalogs

Selection catalogs referenced by `SKILL.md`. Use these when choosing a design direction (Design System Generation, Step 2) — pick and combine from the style table, cross-check against the industry reference, and start layout from the page-structure table.

## Style Reference

25 styles with key characteristics. Use this to select and combine styles — most projects blend 1-2 primary styles.

| Style | Key Characteristics | Best For | Avoid When |
|---|---|---|---|
| **Minimalism / Swiss** | Monochromatic, geometric grid, essential elements only | Enterprise, dashboards, tools | Playful brands, children's products |
| **Glassmorphism** | `backdrop-filter: blur(10-20px)`, translucent overlays, vibrant backgrounds | Modern SaaS, fintech dashboards | Low-performance targets, print |
| **Brutalism / Neubrutalism** | Bold borders 2-4px, primary colors, thick offset shadows, no gradients | Creative agencies, portfolios, Gen-Z | Corporate, healthcare, finance |
| **Neumorphism / Soft UI** | Dual shadows (light+dark), embossed/debossed, monochromatic, rounded | Wellness, smart home, controls | Data-dense, text-heavy, low contrast risk |
| **Claymorphism** | Soft 3D, thick borders 3-4px, double shadows, rounded 16-24px | Educational, children's, playful apps | Corporate, legal, finance |
| **Dark Mode (OLED)** | Deep black `#000`, dark grey `#121212`, neon accents, high contrast | Streaming, dev tools, gaming, fintech | Print content, elderly users |
| **Flat Design** | 2D, bold colors, no shadows, clean lines, icon-heavy | Cross-platform, complex dashboards | Where depth/hierarchy is critical |
| **Bento Box Grid** | Modular cards, asymmetric grid, varied sizes, Apple-style | Product showcases, feature pages | Simple single-column content |
| **Aurora UI** | Vibrant gradients, northern lights, 8-12s ambient animations | Creative, AI platforms, luxury | Performance-constrained, accessibility-critical |
| **Motion-Driven** | Scroll effects, parallax 3-5 layers, 300-400ms transitions | Storytelling, portfolios, agencies | Motion-sensitive users, data tools |
| **Hero-Centric** | Full-viewport hero, compelling headline, high-contrast CTA | Landing pages, product launches | Multi-feature pages, dashboards |
| **Conversion-Optimized** | Single CTA focus, minimal distractions, trust signals, form-centric | Lead gen, signups, pricing pages | Content sites, portfolios |
| **Feature Showcase** | 3-4 column grid, benefit cards, interactive elements | SaaS feature pages, product tours | Simple products, single-function tools |
| **Data-Dense Dashboard** | Multiple charts, KPI cards, data tables, minimal padding, grid | BI/analytics, monitoring, admin | Consumer apps, marketing sites |
| **Executive Dashboard** | Large metrics, summary KPIs, minimal detail, whitespace | C-suite reporting, high-level views | Drill-down analysis, operations |
| **Real-Time Monitoring** | Live data, status indicators, alert pulses, streaming charts | DevOps, IoT, trading, operations | Static content, marketing |
| **Editorial / Magazine** | Asymmetric grid, pull quotes, drop caps, CSS Grid columns | Blogs, news, long-form content | Dashboards, tools, e-commerce |
| **Organic Biophilic** | Nature-inspired, organic shapes, earth tones, flowing SVG | Sustainability, wellness, eco brands | Tech-forward, cybersecurity |
| **AI-Native UI** | Conversational, minimal chrome, streaming text, typing indicators | Chatbots, AI assistants, voice | Data-heavy, multi-panel interfaces |
| **Exaggerated Minimalism** | Oversized type `clamp(3rem, 8vw, 12rem)`, extreme whitespace | Fashion, luxury, art, editorial | Dense information, dashboards |
| **Pixel Art / Retro** | 8-bit aesthetic, blocky, pixelated fonts, nostalgic palette | Gaming, indie, retro brands | Professional services, healthcare |
| **E-Ink / Paper** | Paper-like texture, high contrast, monochrome, reading-focused | Reading apps, documentation, notes | Dynamic content, media-heavy |
| **Spatial UI (VisionOS)** | Glass panels, depth layers, translucent, immersive | XR/VR interfaces, spatial computing | 2D-only contexts, accessibility-first |
| **Cyberpunk** | Neon on black, terminal/HUD, glitch effects, monospace | Gaming, security, crypto, dev tools | Conservative brands, elderly users |
| **Swiss Modernism 2.0** | Strict grid, Helvetica/Inter, modular, 12-column, WCAG AAA | Government, education, documentation | Creative/expressive brands |

---

## Industry Design Reference

Recommended design direction by product category. Use as a starting point — adapt to specific project needs.

| Category | Style | Color Mood | Typography | Effects | Anti-Patterns |
|---|---|---|---|---|---|
| **SaaS** | Glassmorphism + Flat | Trust blue, accent contrast | Professional, clear hierarchy | Subtle hover 200ms, smooth transitions | Excessive animation, dark mode default |
| **E-commerce** | Vibrant + Feature Showcase | Brand primary, success green | Engaging, clear hierarchy | Card hover lift 200ms, scale | Flat without depth, text-heavy pages |
| **E-commerce Luxury** | Liquid Glass + Glassmorphism | Premium minimal, gold accent | Elegant serif + refined sans | Slow animations 400-600ms, parallax | Vibrant block colors, playful tones |
| **Healthcare** | Neumorphism + Accessible | Calm blue, health green | Readable, large 16px+ | Soft shadows, smooth press 150ms | Bright neon, motion-heavy, low contrast |
| **Educational** | Claymorphism + Micro-interactions | Playful, clear hierarchy | Friendly, engaging | Soft press 200ms, progress animations | Dark modes, complex jargon |
| **Financial Dashboard** | Dark Mode + Data-Dense | Dark bg, red/green alerts, trust blue | Clear, readable mono | Real-time number animations, alert pulse | Light mode default, slow rendering |
| **Analytics Dashboard** | Data-Dense + Heat Map | Cool-to-hot gradients, neutral grey | Functional, monospace data | Hover tooltips, chart zoom, filters | Ornate design, no filtering |
| **Creative Agency** | Brutalism + Motion-Driven | Bold primaries, artistic freedom | Bold, expressive, variable | CRT scanlines, neon glow, glitch | Corporate minimalism, hidden portfolio |
| **Portfolio** | Motion-Driven + Minimalism | Brand primary, artistic | Expressive, variable weight | Parallax 3-5 layers, scroll reveals | Corporate templates, generic layouts |
| **Fitness/Gym** | Vibrant + Dark Mode | Energetic orange `#FF6B35`, dark bg | Bold, motivational | Progress rings, achievement unlocks | Static design, no gamification |
| **Restaurant/Food** | Vibrant + Motion-Driven | Warm orange/red/brown | Appetizing, clear | Food image reveals, menu hover | Low-quality imagery, outdated info |
| **Real Estate** | Glassmorphism + Minimalism | Trust blue, gold, white | Professional, confident | 3D property tour, map hover | Poor photos, no virtual tours |
| **Travel** | Aurora UI + Motion-Driven | Vibrant destination, sky blue | Inspirational, engaging | Destination parallax, itinerary animations | Generic photos, complex booking |
| **News/Media** | Minimalism + Flat | Brand + high contrast | Clear, readable serif/sans | Breaking news badges, article reveals | Cluttered layout, slow loading |
| **AI/Chatbot** | AI-Native + Minimalism | Neutral, AI purple `#6366F1` | Modern, clear | Streaming text, typing indicators, fade-in | Heavy chrome, slow response feedback |
| **Developer Tool** | Dark Mode + Minimalism | Syntax theme, blue focus | Monospace, functional | Syntax highlighting, command palette | Light mode default, slow performance |
| **Productivity** | Flat + Micro-interactions | Clear hierarchy, functional | Clean, efficient | Quick actions 150ms, task animations | Complex onboarding, slow performance |
| **Social Media** | Vibrant + Motion-Driven | Vibrant engagement colors | Modern, bold | Scroll animations, icon animations | Heavy skeuomorphism, poor a11y |
| **Gaming** | 3D + Retro-Futurism | Vibrant, neon, immersive | Bold, impactful | WebGL, glitch effects | Minimalist design, static assets |
| **Non-profit** | Accessible + Organic | Cause-related, trust, warm | Heartfelt, readable | Impact counters, story reveals | No impact data, hidden financials |
| **Legal** | Trust & Authority + Minimal | Navy `#1E3A5F`, gold, white | Professional, authoritative | Practice area reveals, credential display | Outdated design, hidden credentials |
| **Banking** | Minimalism + Accessible | Navy, trust blue, gold | Professional, trustworthy | Number animations, security indicators | Playful design, poor security UX |
| **Music Streaming** | Dark Mode + Vibrant | Dark `#121212`, vibrant accents | Modern, bold | Waveform visualization, playlist animations | Cluttered layout, poor audio player |
| **Video Streaming** | Dark Mode + Motion-Driven | Dark bg, poster colors, brand | Bold, engaging | Video player, content carousel parallax | Static layout, slow video player |
| **Job Board** | Flat + Minimalism | Professional blue, success green | Clear, professional | Search/filter animations, application flow | Outdated forms, hidden filters |
| **Marketplace** | Vibrant + Flat | Trust colors, category colors | Modern, engaging | Review animations, listing hover | Low trust signals, confusing layout |
| **Smart Home/IoT** | Glassmorphism + Dark Mode | Dark, status indicator colors | Clear, functional | Device status pulse, quick actions | Slow updates, no automation |
| **Government** | Accessible + Minimalism | Professional blue, high contrast | Clear, large type | Focus rings 3-4px, skip links | Ornate design, low contrast, motion |

---

## Common Page Structures

Use these as starting points for layout composition — adapt to project needs.

| Page Type | Structure | Key Components |
|---|---|---|
| **SaaS Dashboard** | Collapsible sidebar + top bar + main grid | Stat cards, charts, data tables, activity feed, filters |
| **Landing Page** | Hero → social proof → features → how-it-works → pricing → CTA → footer | Hero with CTA, testimonial carousel, feature grid, pricing cards |
| **Admin Panel** | Fixed sidebar + breadcrumb top bar + content area | CRUD tables with sort/filter/search, detail drawers, bulk actions |
| **E-commerce Product** | Sticky nav + image gallery + details + related | Image carousel, variant selector, add-to-cart, reviews, recommendations |
| **Documentation** | Left nav + main content + right TOC (sticky) | Search, version switcher, code blocks with copy, prev/next nav |
| **Blog / Editorial** | Top nav + hero article + content + sidebar | Featured image, reading time, table of contents, share buttons, related |
| **Settings / Profile** | Sidebar tabs or top tabs + form sections | Section nav, form groups, save/cancel, danger zone at bottom |
| **Auth Flow** | Centered card, minimal chrome | Logo, form, social login, link to alt flow (signup↔login), error inline |
