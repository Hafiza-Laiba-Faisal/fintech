---
name: Institutional Defense Engine
colors:
  surface: '#0f131d'
  surface-dim: '#0f131d'
  surface-bright: '#353944'
  surface-container-lowest: '#0a0e18'
  surface-container-low: '#171b26'
  surface-container: '#1c1f2a'
  surface-container-high: '#262a35'
  surface-container-highest: '#313540'
  on-surface: '#dfe2f1'
  on-surface-variant: '#c3c6d7'
  inverse-surface: '#dfe2f1'
  inverse-on-surface: '#2c303b'
  outline: '#8d90a0'
  outline-variant: '#434655'
  surface-tint: '#b4c5ff'
  primary: '#b4c5ff'
  on-primary: '#002a78'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#0053db'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#996100'
  on-tertiary-container: '#ffeedd'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0f131d'
  on-background: '#dfe2f1'
  surface-variant: '#313540'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: '600'
    lineHeight: 2.5rem
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: -0.01em
  mono-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 0.875rem
  label-caps:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: '700'
    lineHeight: 0.875rem
    letterSpacing: 0.05em
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system projects mission-critical authority, unyielding cryptographic rigor, and absolute operational clarity for institutional digital asset custodians and security operations center (SOC) analysts. 

The aesthetic is precision-engineered minimalism fused with technical-brutalist data architecture. The visual tone eliminates all ornamental fluff, whimsical rounding, and frivolous gradients in favor of an unapologetically structured, data-dense command interface. Every pixel reinforces institutional auditability, high-throughput verification, zero-trust verification pipelines, and cryptographic finality. 

Micro-interactions are instantaneous and mechanical: state shifts occur with crisp 100ms transitions, status indicators rely on structural status pills and illuminated indicators rather than ambient glows, and visual hierarchy is sustained strictly through surface luminance stepping, structured grid dividers, and razor-sharp borders.

## Colors

The palette is engineered exclusively for a dark, high-focus operations environment. Color acts with surgical intention: neutral slates provide structural containment, while semantic tokens strictly indicate operational health, cryptographic pass/fail states, and critical threats.

### Color Tokens
- **Canvas Base (`#0B0F19`):** Root background. Unyielding, deep obsidian navy.
- **Surface Level 1 (`#0F172A`):** Primary panel containment, app bar, and dashboard sidebars.
- **Surface Level 2 (`#111827`):** Interior data tables, policy audit cards, and nested module wells.
- **Surface Level 3 (`#1E293B`):** Hover states, active row selections, header rows, and elevated modal panels.
- **Border / Structural Grid (`#334155` at 50% opacity / `#1E293B`):** Razor-thin 1px dividers defining layout bounds.
- **Primary / Cobalt Accents (`#2563EB` base, `#3B82F6` hover/focus):** Used sparingly for primary commit actions, selected navigation items, and focus rings. Never used decoratively.
- **Success / Cryptographic Verified (`#10B981`):** Applied to passed multi-sig thresholds, confirmed block inclusion, healthy quorum, and approved validation checks.
- **Warning / Degraded State (`#F59E0B`):** Indicates pending multisig approvals, lagging node sync, gas spikes, or quarantine states.
- **Critical / Threat Neutralized (`#EF4444`):** Flags rejected transactions, malicious smart contract calls, revoked keys, and policy violations.
- **Typography - High Contrast (`#F8FAFC`):** Primary values, balances, metric counts.
- **Typography - Muted Support (`#94A3B8`):** Table column headers, field labels, metadata descriptors.
- **Typography - Subdued / Hash (`#64748B`):** Nonce markers, timestamp brackets, protocol prefixes.

## Typography

The type system prioritizes scannability, vertical alignment across numeric tables, and unambiguous character delineation. 

- **Primary Interface Font (Inter):** Leveraged for all operational chrome, action items, and data labels. Tabular figures (`tnum`) and slashed zero (`zero`) OpenType features must be toggled on across all components displaying monetary balances or counts.
- **Cryptographic & Hash Font (JetBrains Mono):** Standardized for all raw cryptographic primitives: wallet addresses, transaction hashes, smart contract function signatures, consensus timestamps, and payload inspection outputs.
- **Capitalization Hierarchy:** Subheaders, grid table titles, and metric tags utilize `label-caps` in full uppercase with positive tracking (+0.05em) to enforce clear demarcations between structural boundaries and dynamic transactional values.

## Layout & Spacing

The architecture operates on a rigorous, data-dense 4px/8px layout grid built for maximal information density without visual crowding.

### Grid & Canvas Structure
- **Desktop (1280px and above):** 12-column or 16-column continuous fluid layout bounded by a minimum screen margin of `1.5rem` (`margin`). Column gutters are locked to `1rem` (`gutter`).
- **Tablet (768px - 1279px):** 8-column layout. Sidebars collapse to icon-only navigation rails (64px width). Margins reduce to `1.25rem`.
- **Mobile (Below 768px):** 4-column reflow. Critical security notifications and primary signing requests lock to single-column vertical stacks. Gutters shift to `0.75rem` (`gutter-mobile`).

### Layout Cadence
Internal component padding enforces dense packing: table rows default to 36px or 44px height; operational panels utilize `0.75rem` to `1rem` internal padding. Gaps between grouped metrics follow `space-sm` (8px), while distinct containment panels separate along `space-lg` (16px) or `space-xl` (24px) baselines.

## Elevation & Depth

This design system deliberately rejects heavy, diffuse drop-shadows and blurred glass effects. Depth is expressed purely through **Tonal Layering** combined with **Low-Contrast Razor Outlines**.

- **Z-Index Layering:**
  - Base viewport: `#0B0F19`
  - Functional cards, tables, and side rails: `#0F172A`
  - Inner containers, search inputs, nested modules: `#111827`
  - High-priority inspection drawers and modal overlays: `#1E293B`
- **Border Integration:** Every elevated tier is delineated by a 1px solid border set to `rgba(51, 65, 85, 0.5)` (Slate-700 at 50%). When a surface gains active focus or requires analyst confirmation, its border transitions directly to `rgba(59, 130, 246, 0.8)` without increasing border weight.
- **Overlays & Dialogs:** Modals introduce a strictly flat backdrop dimming layer (`rgba(11, 15, 25, 0.85)`) with an absolute 0px blur filter. No blurred frosted glass. A subtle, non-diffuse hard shadow (`0 4px 0 0 rgba(0, 0, 0, 0.5)`) can be applied only to floating dropdown menus to physically distinguish them from underlying dense tables.

## Shapes

The design system enforces a sharp structural posture: `roundedness: 0`.

- **Corner Geometry:** All buttons, inputs, panels, tooltips, dialogs, badges, and segmented toggles have absolute **0px border-radius**. 
- **Philosophical Alignment:** The razor-sharp edge communicates machine-level precision, cryptographic permanence, and architectural discipline. It optimizes dense data packing by preventing corner whitespace clipping in high-density data matrices.

## Components

### Buttons
- **Primary:** Solid `#2563EB` background, `#F8FAFC` label, 0px border. Hover shifts to `#1D4ED8`. Active state shifts to `#1E40AF`.
- **Secondary / Action Outlined:** Transparent background, 1px solid border in `rgba(51, 65, 85, 0.8)`, `#F8FAFC` label. Hover fills with `#1E293B`.
- **Destructive / Reject:** Deep crimson outline (`#EF4444`) or solid `#EF4444` for high-severity instant actions (e.g., "Halt Contract", "Reject Payload"). Text is white or `#EF4444`.
- **Sizing:** Compact (28px height, 12px font) for inline row actions; Standard (36px height, 14px font) for global command headers.

### Badges & Status Indicators
- **Architecture:** Compact rectangular tags (20px height) featuring a 6px solid circular status dot alongside a `label-caps` descriptor.
- **Pass / Verified:** Background `rgba(16, 185, 129, 0.1)`, 1px border `rgba(16, 185, 129, 0.3)`, text `#10B981`.
- **Quarantined / Warning:** Background `rgba(245, 158, 11, 0.1)`, 1px border `rgba(245, 158, 11, 0.3)`, text `#F59E0B`.
- **Blocked / Threat:** Background `rgba(239, 68, 68, 0.1)`, 1px border `rgba(239, 68, 68, 0.3)`, text `#EF4444`.

### Data Tables & Status Grids
- **Header:** Background `#0F172A`, 1px solid bottom border (`rgba(51, 65, 85, 0.5)`). Text in uppercase `Inter` bold 11px `#94A3B8`.
- **Cells:** Alternating hover state on row (`#1E293B`). Cells use `JetBrains Mono` for addresses, nonces, and gas limits; `Inter` for timestamps and analyst labels.
- **Address & Hash Formatting:** Addresses truncate in center format (e.g., `0x71C...8942`) with a click-to-copy button embedded on hover.

### Inputs & Filters
- **Text & Hash Search:** Background `#111827`, 1px solid `rgba(51, 65, 85, 0.6)`, text `#F8FAFC`, placeholder `#64748B`. Font: `JetBrains Mono` 13px. Focus: 1px solid `#3B82F6` with 0px outline offset.
- **Checkboxes & Radios:** Rigid square boxes (14px × 14px) with 1px border. Checked state displays solid `#2563EB` fill with a sharp geometric checkmark icon.

### Cards & Module Panels
- Rigid structural containers. Background `#0F172A`, 1px solid `rgba(51, 65, 85, 0.5)`. Header dividers run full width with a 1px border. Card titles feature small uppercase category tracking.

### Specialized Component: Security Quorum Matrix
- Displays multi-signature policy approval tracks (e.g., "3 of 5 Keys Required"). Constructed as a horizontal segment of discrete blocks; verified signatures illuminate in solid emerald `#10B981`, pending signatures in dotted amber border `#F59E0B`, and inactive slots in `#1E293B`.