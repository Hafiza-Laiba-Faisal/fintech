---
name: Sleek Minimalist Fintech
colors:
  surface: '#f9f9ff'
  surface-dim: '#d4dae9'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e8eefd'
  surface-container-high: '#e3e8f7'
  surface-container-highest: '#dde2f1'
  on-surface: '#161c26'
  on-surface-variant: '#444654'
  inverse-surface: '#2b313c'
  inverse-on-surface: '#ecf0ff'
  outline: '#747686'
  outline-variant: '#c4c5d7'
  surface-tint: '#2c50d9'
  primary: '#2248d1'
  on-primary: '#ffffff'
  primary-container: '#4263eb'
  on-primary-container: '#f5f3ff'
  inverse-primary: '#b9c3ff'
  secondary: '#555f6d'
  on-secondary: '#ffffff'
  secondary-container: '#d6e0f1'
  on-secondary-container: '#596372'
  tertiary: '#923e00'
  on-tertiary: '#ffffff'
  tertiary-container: '#b95000'
  on-tertiary-container: '#fff2ed'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dde1ff'
  primary-fixed-dim: '#b9c3ff'
  on-primary-fixed: '#001356'
  on-primary-fixed-variant: '#0035be'
  secondary-fixed: '#d9e3f4'
  secondary-fixed-dim: '#bdc7d8'
  on-secondary-fixed: '#121c28'
  on-secondary-fixed-variant: '#3e4755'
  tertiary-fixed: '#ffdbcb'
  tertiary-fixed-dim: '#ffb690'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#783100'
  background: '#f9f9ff'
  on-background: '#161c26'
  surface-variant: '#dde2f1'
typography:
  display:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 56px
    letterSpacing: -0.025em
  display-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  numeric-data:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system expresses institutional trust, precision engineering, and effortless executive clarity. Built for modern financial workflows, the interface avoids decorative excess, prioritizing legibility, balanced density, and direct user action.

The aesthetic blends contemporary high-end Swiss minimalism with structural fintech clarity:
- **Atmosphere:** Light, tranquil, and structured. Surfaces feel physical, immaculate, and architectural.
- **Personality:** Analytical, dependable, discreet, and refined.
- **Tone:** Professional without feeling bureaucratic; technical without feeling intimidating.
- **Target Audience:** High-net-worth operators, finance teams, founders, and modern retail banking customers who value velocity, data integrity, and visual calm.

## Colors

The color system enforces extreme discipline: bright functional neutrals carry structural weight, while color is reserved strictly for interactive affordances and key state changes.

### Core Palette
- **Canvas / Background (`#F7F8FA`):** Warm architectural off-white that prevents screen glare and sets up gentle contrast against card surfaces.
- **Surface / Card (`#FFFFFF`):** Crisp pure white applied to cards, overlays, dialogs, and elevated controls.
- **Main Text (`#202631`):** Deep charcoal neutral providing high readability while avoiding harsh pitch black.
- **Secondary Text (`#737D8C`):** Calibrated muted slate for metadata, helper labels, and secondary context.
- **Structural Borders (`#E5E8EE`):** Low-contrast structural grey for micro-borders, card boundaries, table rules, and dividers.
- **Primary Accent (`#4263EB`):** A disciplined, rich royal blue that signals interactivity, active tabs, and primary action calls.

### Functional & Semantic Roles
- **Success (`#24845B`):** Muted botanical green for positive balances, fulfilled settlements, and verified security states.
- **Error (`#D64545`):** Restrained crimson for transaction failures, validation issues, and destructive intents.
- **Warning (`#A96B13`):** Muted amber for audit warnings, pending authorizations, and verification notices.

Color should never be used as pure decoration; tinting is restricted to contextual metric tags and subtle status pills.

## Typography

The typography relies on Inter to establish a crisp, systematic hierarchy.

- **Tabular Figures:** Always apply OpenType feature settings `tnum` (tabular numbers) and `cv05` or `cv11` when displaying ledger tables, financial balances, ticker cards, and transaction records to prevent character jitter and misaligned columns.
- **Display Weights:** Weights are constrained to `400` (Regular), `500` (Medium), and `600` (Semi-bold). Bold (700+) is excluded to preserve an understated, editorial feel.
- **Headlines:** Use tightened negative tracking across larger typesizes (`-0.015em` to `-0.025em`) to unify word shapes and create a polished modern look.
- **Captions & Metadata:** Keep label variants sharp and legibly spaced using `0.01em` to `0.02em` tracking.

## Layout & Spacing

The layout model implements a structured responsive grid system with calibrated margins that maintain generous breathing room around critical metrics.

- **Desktop (1200px+):** 12-column layout with fixed max-width container (1280px or 1440px wide-screen), 24px gutters, and 32px to 48px outer canvas margin.
- **Tablet (768px – 1199px):** 8-column layout with 20px gutters and 24px margins. Sub-dashboards transition from multi-column grids into stacked split cards.
- **Mobile (< 768px):** 4-column layout with 16px gutters and 16px outer margins. Data tables collapse to atomic transaction lists, and side panels collapse to sheets.
- **Spatial Rhythm:** Elements adhere to an 8px base grid (using 4px half-steps for compact inputs and badge padding). Gaps within cards remain compact (`space-sm` to `space-md`), while gaps separating card groupings remain open (`space-lg` to `space-xl`) to clearly differentiate content zones.

## Elevation & Depth

Visual depth is achieved through high-precision micro-borders and soft ambient shadows, avoiding dark heavy skeuomorphism and floating layered planes.

- **Surface Layering:**
  - **Base Canvas:** `#F7F8FA`
  - **Content Surface:** `#FFFFFF` with a crisp `1px solid #E5E8EE` outline.
  - **Elevated Modals & Popovers:** `#FFFFFF` with a `1px solid #E5E8EE` outline accompanied by an ambient shadow.

- **Shadow Formulation:**
  - **Resting Cards:** `box-shadow: 0 1px 3px 0 rgba(32, 38, 49, 0.04), 0 1px 2px -1px rgba(32, 38, 49, 0.02);`
  - **Interactive Hover:** `box-shadow: 0 4px 12px 0 rgba(32, 38, 49, 0.06), 0 2px 4px -2px rgba(32, 38, 49, 0.03);`
  - **Floating Menus / Dialogs:** `box-shadow: 0 12px 32px -4px rgba(32, 38, 49, 0.08), 0 4px 12px -2px rgba(32, 38, 49, 0.03);`

- **Border Treatment:**
  - All cards, inputs, dropdown menus, and nested groups use a `1px` border set to `#E5E8EE`.
  - Contrast is never forced through dark borders; division is achieved via background contrast between `#F7F8FA` and `#FFFFFF`.

## Shapes

The geometric framework balances human warmth with the precision of a Swiss ledger:
- **Small Controls & Inputs:** 8px radius (`0.5rem`) for text inputs, standard buttons, select fields, and segment tabs.
- **Cards & Primary Modules:** 10px to 12px radius (`rounded-lg` / `rounded-xl`) for metric widgets, summaries, and dialog containers.
- **Pills / Status Badges:** Maximum radius (`9999px`) reserved specifically for transaction indicators, state tags, and avatar counters.
- **Nested Curvature Rule:** Nested elements maintain concentric geometry: parent corners match the child corner radius plus the padding offset, preserving visual balance across modules.

## Components

### Buttons
- **Primary:** Filled `#4263EB` background with pure `#FFFFFF` typography. Crisp 8px border radius, no border outline, subtle resting shadow, darkening to `#3652C7` on hover.
- **Secondary / Outlined:** `#FFFFFF` background, `1px solid #E5E8EE`, `#202631` typography. On hover, background shifts to `#F7F8FA`.
- **Tertiary / Ghost:** Transparent background, `#737D8C` typography, shifting to `#F7F8FA` and `#202631` on hover.
- **Padding:** 10px 16px for standard button heights (38px to 40px hit area). Font weight: `500`.

### Cards & Metrics
- Pure `#FFFFFF` background encased in a clean `1px solid #E5E8EE` border with `12px` rounded corners.
- Internal padding set to `1.25rem` or `1.5rem`.
- Stat widgets feature secondary label on top (`12px`, `#737D8C`), big balance value (`numeric-data`, `#202631`), and bottom status indicator or trend chip.

### Input Fields
- `#FFFFFF` surface with `1px solid #E5E8EE`, 8px radius, and 40px overall height.
- Typography: 14px `#202631` with `#737D8C` placeholder.
- **Focus State:** 1px border transitions to `#4263EB` with a `0 0 0 3px rgba(66, 99, 235, 0.12)` ambient halo. Never use default browser outlines.

### Data Tables & Transaction Lists
- Header: `#F7F8FA` or pure `#FFFFFF` with `1px solid #E5E8EE` bottom border; 11px uppercase bold labels (`#737D8C`).
- Row: 48px to 56px height, alternating transparent background with `1px solid #F0F2F5` horizontal separators. 
- Interactive rows transition to `#F7F8FA` on cursor hover. Numbers use tabular figures (`font-variant-numeric: tabular-nums`).

### Chips & Badges
- 20px to 24px height, full pill shape (`rounded-full`), padded 4px 10px.
- **Success:** Background `rgba(36, 132, 91, 0.08)`, text `#24845B`.
- **Warning:** Background `rgba(169, 107, 19, 0.08)`, text `#A96B13`.
- **Error:** Background `rgba(214, 69, 69, 0.08)`, text `#D64545`.
- **Neutral:** Background `#F7F8FA`, border `1px solid #E5E8EE`, text `#737D8C`.

### Checkboxes & Segmented Controls
- **Checkboxes & Radios:** 16px square/circle with `1px solid #E5E8EE`. Checked state transitions immediately to `#4263EB` fill with white glyph check.
- **Segmented Control:** Enclosed container in `#F7F8FA` with `1px solid #E5E8EE`, padded by 3px. Active segment uses an elevated `#FFFFFF` pill card with resting micro-shadow.