# Pro Dark UI Design System
## Technical Software Interface Specification

**Version:** 1.0  
**Classification:** Design System / Agent Skill  
**Scope:** Professional tool interfaces, investigative software, data visualization platforms  
**Inspiration:** DaVinci Resolve, VS Code, Blender, Palantir Gotham  

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Visual Foundation](#2-visual-foundation)
3. [Layout Architecture](#3-layout-architecture)
4. [Navigation System](#4-navigation-system)
5. [Component Specifications](#5-component-specifications)
6. [Command Palette](#6-command-palette)
7. [Information Density](#7-information-density)
8. [Animation & Motion](#8-animation--motion)
9. [Feature-Specific Patterns](#9-feature-specific-patterns)
10. [Iconography](#10-iconography)
11. [Accessibility](#11-accessibility)
12. [Implementation Stack](#12-implementation-stack)
13. [Anti-Patterns](#13-anti-patterns)

---

## 1. Design Philosophy

### 1.1 Core Tenets

| Tenet | Description | Rationale |
|-------|-------------|-----------|
| **Expert-First** | Assume the user is a trained professional. Minimize hand-holding, maximize density. | Experts work faster with density; novices learn through command palette discovery. |
| **Keyboard Sovereignty** | Every frequent action must be accessible via keyboard. The mouse is secondary for navigation. | Speed. Professionals do not move their hands from the keyboard. |
| **Canvas Supremacy** | The main work area is sacred. UI chrome must never obstruct it unless explicitly summoned. | Content is the product; chrome is overhead. |
| **Persistent State** | Every user preference, panel position, zoom level, and filter persists across sessions. | Interruption recovery. Users resume work instantly. |
| **Functional Honesty** | No decorative elements. Every pixel must serve a functional purpose. | Reduces cognitive load and visual noise. |

### 1.2 Design Language Name

This system is referred to as **Pro Dark Interface (PDI)** — a convergence of:
- **Technical Dark UI**: The visual aesthetic (dark canvas, high contrast, minimal chrome)
- **IDE-Style Layout**: Dockable panels, tabbed documents, sidebar navigation
- **Command Palette Interface (CPI)**: Search-driven, keyboard-first interaction model
- **High-Density Information UI**: Maximum data per pixel, progressive disclosure

### 1.3 User Mental Model

The user thinks in terms of:
1. **Where am I?** → Context (current view, selected entity)
2. **What can I do?** → Command palette / context menu / toolbar
3. **What changed?** → Status bar / toast notifications / visual indicators

Never force the user to hunt for functionality. Every action is reachable within **three layers of navigation**.

---

## 2. Visual Foundation

### 2.1 Color System

#### 2.1.1 Background Hierarchy (The "Dark Stack")

The background uses a strict 4-level gray scale. No gradients. No shadows for elevation — elevation is communicated through lighter backgrounds.

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `bg-base` | `#0d1117` | `13, 17, 23` | Deepest layer. App background, empty canvas, modal backdrop. |
| `bg-surface` | `#161b22` | `22, 27, 34` | Panel backgrounds, sidebar, tab bars, cards. |
| `bg-elevated` | `#21262d` | `33, 38, 45` | Elevated elements: dropdowns, popovers, tooltips, active list items. |
| `bg-border` | `#30363d` | `48, 54, 61` | Borders, dividers, separators, focus rings. |

**Rule:** If an element needs to appear "above" another, use the next lighter background token. Never use shadows for elevation in the dark theme.

#### 2.1.2 Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#c9d1d9` | Primary text, labels, headings. |
| `text-secondary` | `#8b949e` | Secondary text, placeholders, disabled states, metadata. |
| `text-tertiary` | `#6e7681` | Tertiary text, timestamps, IDs, very subtle labels. |
| `text-inverse` | `#0d1117` | Text on accent-colored backgrounds. |

#### 2.1.3 Accent Colors (Status & Action)

Use **one primary accent** for the entire application. Additional colors are reserved strictly for semantic status.

| Token | Hex | Usage |
|-------|-----|-------|
| `accent-primary` | `#58a6ff` | Primary actions, active states, links, selection highlights. |
| `accent-hover` | `#79c0ff` | Hover state for primary accent elements. |
| `accent-subtle` | `rgba(88, 166, 255, 0.15)` | Subtle backgrounds for selected items, active tabs. |
| `status-success` | `#3fb950` | Positive status: saved, connected, verified, active. |
| `status-warning` | `#d29922` | Warning status: pending, unsaved changes, attention required. |
| `status-danger` | `#f85149` | Error status: failed, disconnected, critical alert, destructive action. |
| `status-info` | `#58a6ff` | Informational status: neutral notifications, tips. |

**Critical Rule:** The primary accent (`#58a6ff`) must be the **only** non-grayscale color used for interactive elements. Do not introduce additional brand colors for buttons, tabs, or navigation. Color is a scarce resource — use it for meaning, not decoration.

#### 2.1.4 Semantic Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| `bg-success-subtle` | `rgba(63, 185, 80, 0.15)` | Success toast background, verified badge background. |
| `bg-warning-subtle` | `rgba(210, 153, 34, 0.15)` | Warning toast background, pending state background. |
| `bg-danger-subtle` | `rgba(248, 81, 73, 0.15)` | Error toast background, failed state background. |

#### 2.1.5 Overlay & Backdrop

| Token | Value | Usage |
|-------|-------|-------|
| `backdrop` | `rgba(13, 17, 23, 0.75)` | Modal backdrops, command palette overlay. |
| `backdrop-heavy` | `rgba(13, 17, 23, 0.90)` | Full-screen overlays, loading states. |

### 2.2 Typography

#### 2.2.1 Font Stack

| Purpose | Font Stack | Fallback |
|---------|-----------|----------|
| **UI Text** | Inter, SF Pro Display, Segoe UI | `system-ui, -apple-system, sans-serif` |
| **Data / Code** | JetBrains Mono, SF Mono, Fira Code | `ui-monospace, monospace` |
| **Monospace Data** | JetBrains Mono | `monospace` |

**Rule:** Use monospace for all machine-generated data: IDs, timestamps, coordinates, IP addresses, hash values, version numbers. Use proportional (Inter) for all human-readable content: labels, descriptions, names.

#### 2.2.2 Type Scale

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `text-xs` | 11px | 400 | 1.4 | 0.01em | Timestamps, badge text, status indicators, metadata. |
| `text-sm` | 12px | 400 | 1.5 | 0 | Secondary labels, input placeholders, table headers. |
| `text-base` | 13px | 400 | 1.5 | 0 | **Default body text.** Primary labels, descriptions, form labels. |
| `text-md` | 14px | 400 | 1.5 | 0 | Slightly emphasized body text, sidebar section headers. |
| `text-lg` | 16px | 500 | 1.4 | -0.01em | Panel titles, modal headers, section headings. |
| `text-xl` | 20px | 600 | 1.3 | -0.02em | Major headings, empty state titles. |
| `text-2xl` | 24px | 600 | 1.2 | -0.02em | Page-level headings, welcome screens. |

**Rule:** 13px is the default body size. Do not use 16px as default — it wastes space and breaks density. 11px is the absolute minimum for readable UI text.

#### 2.2.3 Font Weight Usage

| Weight | Usage |
|--------|-------|
| 400 (Regular) | Body text, labels, descriptions. |
| 500 (Medium) | Emphasized labels, active tab text, button text. |
| 600 (Semibold) | Headings, selected items, key data points. |
| 700 (Bold) | **Never use.** Too heavy for dark backgrounds; creates visual noise. |

### 2.3 Spacing System

Use a 4px base grid. All spacing values are multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight internal padding, icon-to-text gap. |
| `space-2` | 8px | Button internal padding (vertical), list item padding (vertical), inline gap. |
| `space-3` | 12px | Panel internal padding, form field gap, card padding. |
| `space-4` | 16px | Section gap, modal padding, sidebar section padding. |
| `space-5` | 20px | Large section separation. |
| `space-6` | 24px | Major layout gaps, between panels. |
| `space-8` | 32px | Page-level padding, empty state spacing. |

**Density Override:** For data-dense views (tables, logs, node lists), reduce `space-2` to `space-1` (4px vertical padding) and `space-3` to `space-2` (8px horizontal padding).

### 2.4 Borders & Radii

| Token | Value | Usage |
|-------|-------|-------|
| `border-width` | 1px | All borders, dividers, outlines. |
| `border-color` | `#30363d` | Default border color. |
| `border-focus` | `#58a6ff` | Focus ring color. |
| `radius-sm` | 4px | Buttons, inputs, badges, small elements. |
| `radius-md` | 6px | Cards, dropdowns, popovers, panels. |
| `radius-lg` | 8px | Modals, command palette, large floating panels. |
| `radius-full` | 9999px | Pills, status badges, avatar containers. |

**Rule:** Do not use `radius-lg` (8px) for small interactive elements. Buttons must be `radius-sm` (4px). The overall feel should be slightly sharp — not brutalist, but technical.

---

## 3. Layout Architecture

### 3.1 The IDE-Style Grid

The application layout follows a rigid grid system inspired by professional IDEs and compositors.

```
┌─────────────────────────────────────────────────────────────────────┐
│  APP HEADER (28px)                                                  │
│  [App Icon] [Menu: File Edit View Tools Help] [Search] [User]       │
├──────────┬──────────────────────────────────────────────┬───────────┤
│          │                                              │           │
│  LEFT    │                                              │  RIGHT    │
│  SIDEBAR │           MAIN CANVAS                        │  PANEL    │
│  (240px) │           (fluid, min 400px)                 │  (280px)  │
│          │                                              │           │
│  [Tabs]  │  ┌──────────────────────────────────────┐   │  [Tabs]   │
│  ─────── │  │  TAB BAR (36px)                      │   │  ───────  │
│  Files   │  │  [Tab 1] [Tab 2] [Tab 3 ▾] [+]      │   │  Inspector│
│  Search  │  ├──────────────────────────────────────┤   │  History  │
│  Network │  │                                      │   │           │
│          │  │  CONTENT AREA                        │   │           │
│          │  │  (graph, table, form, timeline)      │   │           │
│          │  │                                      │   │           │
│          │  │                                      │   │           │
│          │  └──────────────────────────────────────┘   │           │
├──────────┴──────────────────────────────────────────────┴───────────┤
│  STATUS BAR (24px)                                                  │
│  [Context] [Coordinates/Info] [Zoom] [Errors] [Status] [Time]       │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Panel System

#### 3.2.1 Panel Types

| Type | Behavior | Default Width | Collapsible |
|------|----------|---------------|-------------|
| **Primary Sidebar** | Left side, contains global navigation and file/project structure. | 240px | Yes (pin icon or drag to edge) |
| **Secondary Sidebar** | Right side, contains contextual tools, inspector, properties. | 280px | Yes |
| **Bottom Panel** | Collapsible panel below canvas for logs, terminal, timeline. | 100% (full width) | Yes |
| **Floating Panel** | Detached, draggable, can be moved to secondary monitor. | 320px | Close button only |

#### 3.2.2 Panel States

| State | Visual Treatment |
|-------|-----------------|
| **Expanded** | Full width, content visible, tab label visible. |
| **Collapsed** | Width: 36px. Only icon visible, rotated 90° text label (if vertical). Hover shows tooltip with full label. |
| **Hidden** | Not rendered. Accessible via View menu or command palette. |
| **Floating** | Rendered in a separate window or absolute-positioned div with `box-shadow: 0 8px 24px rgba(0,0,0,0.4)`. |

#### 3.2.3 Resizing

- All panels (except floating) must be resizable via drag on the inner edge.
- Minimum width: 180px (sidebar), 200px (right panel).
- Resize cursor: `col-resize` (horizontal), `row-resize` (vertical).
- No resize animation — the panel follows the cursor in real-time.

### 3.3 Tab System

#### 3.3.1 Tab Bar

- Height: 36px.
- Background: `bg-surface`.
- Border-bottom: 1px `bg-border`.
- Each tab: height 36px, padding `0 12px`, background transparent.
- Active tab: background `bg-base`, border-top: 2px `accent-primary` (the "active indicator"), text color `text-primary`.
- Inactive tab: text color `text-secondary`, hover background `bg-elevated`.
- Close button (×): appears on hover, 14px, color `text-tertiary`, hover `status-danger`.
- New tab button (+): 28px square, `radius-sm`, right-aligned.

#### 3.3.2 Tab Behavior

- Tabs are ordered by access time (most recent at the right, or configurable).
- Middle-click on tab: close.
- Drag tab: reorder within bar, or detach to create floating panel.
- Unsaved changes: dot indicator (●) before tab name, color `status-warning`.

### 3.4 App Header

- Height: 28px (compact — this is not a marketing site header).
- Background: `bg-base`.
- Border-bottom: 1px `bg-border`.
- Content: App icon (16px), menu bar (File, Edit, View, Tools, Help — each 12px text), global search trigger, user avatar.
- **No logo lockup, no tagline, no marketing content.**

### 3.5 Status Bar

- Height: 24px.
- Background: `accent-primary` at 10% opacity, or `bg-surface` with top border.
- Content (left to right):
  1. **Context**: Current view name / selected entity count.
  2. **Info**: Coordinates, zoom level, record count, file size.
  3. **Errors**: Red dot + count if errors exist. Click opens error panel.
  4. **Status**: Connection status, sync status, last saved time.
  5. **Time**: Current time (optional).

---

## 4. Navigation System

### 4.1 The Three-Layer Rule

Every user action must be reachable within **three layers of navigation**:

| Layer | Name | Access Method | Examples |
|-------|------|---------------|----------|
| **L1** | Global | Sidebar, App Header, Keyboard shortcuts | Switching views, opening files, global search |
| **L2** | Contextual | Toolbar, Tab bar, Right-click menu, Panel tabs | Entity actions, view-specific tools, formatting |
| **L3** | Action | Command Palette, Keyboard shortcuts, Inline buttons | Specific commands: "Export CSV", "Merge nodes", "Run query" |

**If an action requires more than 3 layers, it must be accessible via the Command Palette.**

### 4.2 Global Navigation (Layer 1)

#### 4.2.1 Sidebar Navigation

- **Structure**: Vertical list of sections, each collapsible.
- **Section Header**: 24px height, `text-sm` uppercase, `text-tertiary`, letter-spacing 0.05em. Click to collapse/expand.
- **Nav Item**: 28px height, padding-left 12px, `text-base`, `text-secondary`.
  - Icon: 16px, left of text, 8px gap.
  - Active: background `accent-subtle`, text `accent-primary`, left border 2px `accent-primary`.
  - Hover: background `bg-elevated`.
  - Badge: right-aligned, `radius-full`, `text-xs`, background `status-danger`, text white.
- **Sub-items**: Indent 16px, height 24px, `text-sm`.

#### 4.2.2 Keyboard Shortcuts (Global)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + P` | Open Command Palette (Command Mode) |
| `Cmd/Ctrl + K` | Open Command Palette (Quick Action Mode) |
| `Cmd/Ctrl + B` | Toggle Primary Sidebar |
| `Cmd/Ctrl + J` | Toggle Bottom Panel |
| `Cmd/Ctrl + \` | Toggle Right Panel |
| `Cmd/Ctrl + W` | Close Active Tab |
| `Cmd/Ctrl + Shift + T` | Reopen Closed Tab |
| `Cmd/Ctrl + 1-9` | Switch to Tab N |
| `Cmd/Ctrl + ,` | Open Settings |

### 4.3 Contextual Navigation (Layer 2)

#### 4.3.1 Toolbar

- Position: Below tab bar or floating above canvas (contextual).
- Height: 32px.
- Background: `bg-surface` or transparent with subtle border.
- Content: Icon buttons (20px) with tooltips, dropdown triggers, divider lines.
- **Grouped actions**: Related buttons clustered with 1px `bg-border` dividers between groups.
- **Active toggle buttons**: Background `accent-subtle`, icon color `accent-primary`.

#### 4.3.2 Context Menu (Right-Click)

- Trigger: Right-click on any entity, node, row, or canvas area.
- Width: min 160px, max 280px.
- Background: `bg-elevated`.
- Border: 1px `bg-border`, `radius-md`.
- Shadow: `0 4px 12px rgba(0,0,0,0.3)`.
- Item height: 28px, padding `0 12px`, `text-base`.
- Hover: background `accent-subtle`, text `accent-primary`.
- Divider: 1px `bg-border`, margin 4px 0.
- Shortcut display: right-aligned, `text-tertiary`, `text-xs`.

### 4.4 Action Navigation (Layer 3)

See Section 6: Command Palette.

---

## 5. Component Specifications

### 5.1 Buttons

#### 5.1.1 Button Variants

| Variant | Background | Text | Border | Hover Background | Usage |
|---------|-----------|------|--------|------------------|-------|
| **Primary** | `accent-primary` | `text-inverse` | none | `accent-hover` | Main CTA, submit, confirm. |
| **Secondary** | `bg-elevated` | `text-primary` | 1px `bg-border` | `bg-border` | Secondary actions, cancel. |
| **Tertiary / Ghost** | transparent | `text-secondary` | none | `bg-elevated` | Low-priority actions, icon buttons. |
| **Danger** | `status-danger` | `text-inverse` | none | `lighten(status-danger, 10%)` | Destructive: delete, remove, disconnect. |
| **Success** | `status-success` | `text-inverse` | none | `lighten(status-success, 10%)` | Confirmatory: connect, verify, activate. |

#### 5.1.2 Button Sizes

| Size | Height | Padding | Font | Usage |
|------|--------|---------|------|-------|
| **Small** | 24px | `0 8px` | `text-xs` | Inline actions, table row actions, compact toolbars. |
| **Default** | 28px | `0 12px` | `text-sm` | Standard form actions, modal buttons. |
| **Large** | 32px | `0 16px` | `text-base` | Primary modals, welcome screens. |

#### 5.1.3 Icon Buttons

- Size: 28px × 28px (default), 24px × 24px (small).
- Background: transparent (default), `bg-elevated` (hover).
- Icon: 16px centered, color `text-secondary`.
- Active: background `accent-subtle`, icon `accent-primary`.
- Tooltip: mandatory on hover, delay 300ms, `text-sm`.

#### 5.1.4 Button Groups

- Multiple related buttons joined horizontally.
- First button: `radius-sm` left corners only.
- Last button: `radius-sm` right corners only.
- Middle buttons: no radius.
- Divider: 1px `bg-border` between buttons.

### 5.2 Inputs

#### 5.2.1 Text Input

- Height: 28px (default), 24px (compact).
- Background: `bg-base`.
- Border: 1px `bg-border`, `radius-sm`.
- Padding: `0 8px`.
- Font: `text-base`, color `text-primary`.
- Placeholder: `text-tertiary`.
- Focus: border `accent-primary`, box-shadow `0 0 0 2px accent-subtle`.
- Disabled: background `bg-surface`, text `text-tertiary`, cursor not-allowed.
- Error: border `status-danger`, background `bg-danger-subtle`.

#### 5.2.2 Search Input

- Same as text input but with:
  - Left icon: Search (16px, `text-tertiary`).
  - Right: Clear button (×) appears when text present.
  - Placeholder: "Search..." or context-specific: "Search profiles..."
  - Shortcut hint: `text-tertiary`, `text-xs`, right-aligned inside input when empty (e.g., "⌘K").

#### 5.2.3 Textarea

- Min-height: 64px.
- Max-height: 400px (with auto-expand).
- Background: `bg-base`.
- Border: 1px `bg-border`.
- Padding: 8px.
- Font: `text-base`, line-height 1.6.
- Resize: vertical only (or none for auto-expand).

#### 5.2.4 Select / Dropdown

- Trigger: same dimensions as text input, with right-aligned chevron icon (12px).
- Dropdown: `radius-md`, background `bg-elevated`, border 1px `bg-border`, shadow `0 4px 12px rgba(0,0,0,0.3)`.
- Item height: 28px, padding `0 12px`.
- Active item: background `accent-subtle`, text `accent-primary`.
- Group headers: `text-xs` uppercase, `text-tertiary`, padding 8px 12px.

#### 5.2.5 Checkbox

- Size: 14px × 14px.
- Border: 1px `bg-border`, `radius-sm` (2px).
- Unchecked: background `bg-base`.
- Checked: background `accent-primary`, border `accent-primary`, white checkmark icon (10px).
- Indeterminate: background `accent-primary`, horizontal line (8px, white).
- Label: `text-base`, 8px gap from checkbox.

#### 5.2.6 Radio Button

- Size: 14px × 14px.
- Border: 1px `bg-border`, `radius-full`.
- Unchecked: background `bg-base`.
- Checked: border `accent-primary`, inner dot 6px `accent-primary`.
- Label: `text-base`, 8px gap.

#### 5.2.7 Toggle / Switch

- Track: 28px × 16px, `radius-full`, background `bg-border`.
- Thumb: 12px × 12px, `radius-full`, background `text-secondary`, positioned 2px from edge.
- Checked: track background `accent-primary`, thumb background white, translated 12px.
- Transition: 150ms ease.

### 5.3 Data Display

#### 5.3.1 Data Table (Critical Component)

**The data table is the primary way to display lists of entities.**

- Container: background `bg-surface`, border 1px `bg-border`, `radius-md`.
- Header row: height 32px, background `bg-elevated`, border-bottom 1px `bg-border`.
  - Header text: `text-sm`, `text-secondary`, uppercase, letter-spacing 0.03em.
  - Sortable headers: hover `text-primary`, sort indicator icon (▲▼) right-aligned, `accent-primary` when active.
- Row: height 32px (default), 28px (compact mode).
  - Border-bottom: 1px `bg-border` (subtle, or none with alternating row backgrounds).
  - Text: `text-base`, `text-primary`.
  - Hover: background `bg-elevated`.
  - Selected: background `accent-subtle`, left border 2px `accent-primary`.
- Cell padding: `0 12px`.
- Empty state: centered, `text-secondary`, icon + message.
- Pagination: below table, height 32px, `text-sm`.

**Inline Actions:**
- On row hover: action buttons appear at the right end of the row (opacity 0 → 1, 100ms).
- Actions: Edit (pencil), Delete (trash), View (eye) — icon buttons, 20px.

#### 5.3.2 Tree View

- Used for hierarchical data: file systems, organizational charts, evidence folders.
- Item height: 24px.
- Indent: 16px per level.
- Chevron: 12px, `text-tertiary`, rotates 90° when expanded.
- Icon: 16px, file/folder type icon, left of label.
- Label: `text-sm`, `text-secondary`.
- Selected: background `accent-subtle`, text `accent-primary`.
- Hover: background `bg-elevated`.

#### 5.3.3 Cards

- **Use sparingly.** Cards are for dashboards and summaries, not for dense data lists.
- Background: `bg-surface`.
- Border: 1px `bg-border`.
- Radius: `radius-md` (6px).
- Padding: `space-3` (12px).
- Shadow: none (elevation is communicated through border, not shadow in dark UI).
- Header: `text-md`, `text-primary`, semibold, margin-bottom 8px.
- Content: `text-base`, `text-secondary`.

### 5.4 Feedback Components

#### 5.4.1 Toast / Notification

- Position: bottom-right, 16px from edges, stacked vertically with 8px gap.
- Width: 320px min, 400px max.
- Background: `bg-elevated`.
- Border-left: 3px solid (color based on type: success/warning/danger/info).
- Padding: 12px.
- Content: Title (`text-sm` semibold) + Message (`text-sm` regular).
- Close: × icon, top-right, 16px.
- Auto-dismiss: 5 seconds (success/info), persistent (warning/danger).
- Progress bar: thin line at bottom, animates width 100% → 0% over 5s.

#### 5.4.2 Modal / Dialog

- Backdrop: `backdrop`, click to close (unless critical).
- Modal: `radius-lg`, background `bg-surface`, border 1px `bg-border`.
- Shadow: `0 8px 32px rgba(0,0,0,0.4)`.
- Max-width: 480px (small), 640px (medium), 900px (large).
- Header: 48px, padding 16px, title `text-lg`, close button right.
- Body: padding 16px, max-height 70vh, overflow-y auto.
- Footer: 48px, padding 12px 16px, border-top 1px `bg-border`, actions right-aligned.
- Animation: fade in 150ms + scale 0.98 → 1.0, 150ms, `ease-out`.

#### 5.4.3 Tooltip

- Background: `bg-elevated`.
- Border: 1px `bg-border`.
- Padding: 6px 8px.
- Font: `text-sm`.
- Color: `text-primary`.
- Arrow: 6px, same background/border.
- Delay: 300ms (hover), instant (keyboard focus).
- Max-width: 240px.

#### 5.4.4 Loading / Skeleton

- Skeleton: `bg-elevated` with animated shimmer (gradient sweep left to right, 1.5s loop, opacity 0.3 → 0.6).
- Spinner: 16px, `accent-primary`, rotating SVG, 1s linear infinite.
- Progress bar: 4px height, `accent-primary` fill, `bg-border` track.

### 5.5 Badge / Tag

- Height: 20px.
- Padding: `0 8px`.
- `radius-full`.
- Font: `text-xs`, semibold.
- Variants:
  - Default: background `bg-elevated`, text `text-secondary`, border 1px `bg-border`.
  - Primary: background `accent-subtle`, text `accent-primary`.
  - Success: background `bg-success-subtle`, text `status-success`.
  - Warning: background `bg-warning-subtle`, text `status-warning`.
  - Danger: background `bg-danger-subtle`, text `status-danger`.

### 5.6 Divider / Separator

- Horizontal: 1px height, background `bg-border`, margin 8px 0.
- Vertical: 1px width, background `bg-border`, margin 0 8px.
- In panels: full-bleed (no margin).

### 5.7 Scrollbar

- Width: 10px (vertical), 10px (horizontal).
- Track: transparent.
- Thumb: `bg-border`, `radius-full`.
- Thumb hover: `text-tertiary`.
- Active: `text-secondary`.
- **Custom scrollbar mandatory.** Default OS scrollbars break the dark aesthetic.

---

## 6. Command Palette

### 6.1 Overview

The Command Palette is the **primary nervous system** of the application. It is not a secondary feature — it is the main way users discover and execute actions, especially for features they use infrequently.

### 6.2 Trigger Methods

| Method | Behavior |
|--------|----------|
| `Cmd/Ctrl + Shift + P` | Opens in **Command Mode**: lists all available commands, grouped by category. |
| `Cmd/Ctrl + K` | Opens in **Quick Action Mode**: contextual commands based on current view/selection. |
| `Cmd/Ctrl + /` | Opens **Help Mode**: searchable help topics and keyboard shortcuts. |
| Click on search icon in header | Opens Quick Action Mode. |

### 6.3 Visual Specification

- Position: centered horizontally, top 20% vertically.
- Width: 640px max, 90vw on small screens.
- Background: `bg-surface`.
- Border: 1px `bg-border`.
- Radius: `radius-lg` (8px).
- Shadow: `0 16px 48px rgba(0,0,0,0.5)`.
- Backdrop: `backdrop` (blocks interaction with rest of app).

#### 6.3.1 Input Area

- Height: 48px.
- Padding: `0 16px`.
- Border-bottom: 1px `bg-border`.
- Icon: Search (16px, `text-tertiary`), left-aligned.
- Input: borderless, background transparent, `text-lg`, color `text-primary`, placeholder "Type a command or search...".
- Right side: Close hint (Esc), `text-tertiary`, `text-xs`.

#### 6.3.2 Results Area

- Max-height: 400px, overflow-y auto.
- Padding: 8px 0.

**Result Item:**
- Height: 40px.
- Padding: `0 16px`.
- Layout: [Icon 16px] [Label `text-base`] [Shortcut `text-tertiary text-xs`] [Context `text-tertiary text-xs`].
- Icon: Command icon or entity type icon, `text-secondary`.
- Label: Command name, `text-primary`.
- Selected: background `accent-subtle`, icon and label `accent-primary`.
- Hover (non-selected): background `bg-elevated`.

**Group Header:**
- Height: 24px.
- Padding: `0 16px`.
- Text: `text-xs`, uppercase, `text-tertiary`, letter-spacing 0.05em.
- Label: Category name (e.g., "File", "Edit", "View", "Tools", "Recent").

### 6.4 Behavior Specification

#### 6.4.1 Search Logic

- **Fuzzy matching**: Typing "cnv" matches "Criminal Net Visualization", "Create New View", etc.
- **Scoring**: Exact prefix matches > substring matches > fuzzy matches.
- **Recent commands**: Last 5 executed commands appear at the top under "Recent".
- **Contextual boost**: Commands relevant to the current view are scored higher.
- **No results**: Show "No commands found" with suggestion to search help or use different keywords.

#### 6.4.2 Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑ / ↓` | Navigate results. Wraps around (top → bottom, bottom → top). |
| `Enter` | Execute selected command. |
| `Esc` | Close palette, return focus to previous element. |
| `Tab` | Move focus between input and results (accessibility). |
| `Cmd/Ctrl + N` | If result is a file/entity, open in new tab instead of current. |

#### 6.4.3 Command Structure

Every command registered in the palette must have:

```typescript
interface Command {
  id: string;           // Unique identifier: "file.export.csv"
  label: string;        // Display name: "Export as CSV"
  category: string;     // Group: "File", "Edit", "View", "Tools"
  icon?: string;        // Icon name (optional)
  shortcut?: string;    // Keyboard shortcut display: "Ctrl+Shift+E"
  context?: string[];   // View IDs where this command is relevant
  action: () => void;   // Handler function
  disabled?: boolean;   // Grayed out if true
}
```

#### 6.4.4 Contextual Commands

When opened with `Cmd+K`, the palette pre-filters commands based on:
- Current active view (e.g., "Criminal Net" view shows graph-related commands first).
- Current selection (e.g., node selected shows "Delete Node", "Expand Node", "View Profile").
- Recent actions in this context.

### 6.5 Empty States

- **No commands found**: "No commands match 'xyz'. Try searching help topics or use different keywords."
- **No recent commands**: "No recent commands. Start typing to see available actions."

---

## 7. Information Density

### 7.1 Density Principles

This system prioritizes **information density over whitespace**. The user is assumed to be a professional who needs to see maximum relevant data at once.

#### 7.1.1 Density Tiers

| Tier | Padding | Usage |
|------|---------|-------|
| **Compact** | 4px vertical, 8px horizontal | Tables with >20 rows, log viewers, code listings, timeline events. |
| **Default** | 8px vertical, 12px horizontal | Standard tables, form fields, list views. |
| **Relaxed** | 12px vertical, 16px horizontal | Settings panels, detail views, onboarding, empty states. |

### 7.2 Data Table Density Rules

- **Default row height**: 32px.
- **Compact row height**: 28px (for tables with >50 rows or when screen real estate is critical).
- **Cell padding**: `0 12px` (default), `0 8px` (compact).
- **Header row**: Always 32px, `bg-elevated`.
- **Alternating rows**: Not recommended in dark UI. Use subtle hover state instead.
- **Borders**: 1px `bg-border` between rows. No vertical borders between columns.
- **Text truncation**: Ellipsis (...) with tooltip on hover for overflow.
- **Column resizing**: Drag column borders to resize. Minimum 60px per column.

### 7.3 Progressive Disclosure

Never show all data at once. Use progressive disclosure:

| Level | Data Shown | Access Method |
|-------|-----------|---------------|
| **Summary** | 5-7 key fields | Default table row, card preview. |
| **Detail** | Full field set | Click row → sidebar panel or modal. |
| **Full Record** | All historical data, relationships, raw data | Click "View Full Profile" → dedicated view. |

### 7.4 Inline Actions Pattern

- **Default state**: Action buttons hidden (opacity 0).
- **Hover state**: Action buttons appear at row end (opacity 1, 100ms fade).
- **Keyboard**: Tab into row → actions become focusable.
- **Touch**: Always visible on touch devices (no hover state).

### 7.5 Monospace Data Display

Use monospace font for:
- UUIDs, IDs, hashes
- Timestamps (ISO 8601 format preferred: `2024-01-15T14:30:00Z`)
- IP addresses, MAC addresses
- Coordinates (lat/long)
- File sizes, version numbers
- Code snippets, JSON, SQL

### 7.6 Status Indicators

- **Dot indicator**: 8px circle, `radius-full`, color-coded.
- **Icon indicator**: 14px icon (check, alert, x) with color.
- **Badge indicator**: As per Section 5.5.
- **Position**: Left-aligned in cell, before text. Or right-aligned as standalone column.

---

## 8. Animation & Motion

### 8.1 Motion Philosophy

Motion is **functional, not decorative**. Every animation must serve a purpose:
- **Spatial orientation**: Show where something came from or went.
- **State change**: Indicate that something has changed.
- **Perceived performance**: Make the UI feel responsive even if data is loading.

**Anti-goal:** Delight, playfulness, or drawing attention to the animation itself.

### 8.2 Timing Tokens

| Token | Duration | Usage |
|-------|----------|-------|
| `duration-instant` | 0ms | Tab switches, color changes on hover, text selection. |
| `duration-fast` | 50ms | Micro-interactions: button press, checkbox check. |
| `duration-normal` | 150ms | Standard transitions: hover states, panel toggle, dropdown open. |
| `duration-medium` | 200ms | Panel slide, sidebar collapse, modal appearance. |
| `duration-slow` | 300ms | Page transitions, major layout changes, toast entrance. |

### 8.3 Easing Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard transitions. |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Elements exiting (fade out, slide out). |
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Elements entering (fade in, slide in). |
| `ease-snap` | `cubic-bezier(0.16, 1, 0.3, 1)` | Command palette, modals — snappy but smooth. |

### 8.4 Component Animations

| Component | Animation | Duration | Easing |
|-----------|-----------|----------|--------|
| **Command Palette** | Scale 0.98 → 1.0 + fade in | 150ms | `ease-snap` |
| **Modal** | Fade backdrop + scale modal 0.98 → 1.0 | 150ms | `ease-snap` |
| **Dropdown / Popover** | Fade + slight translateY (-4px → 0) | 100ms | `ease-out` |
| **Panel Collapse** | Width/height transition | 200ms | `ease-default` |
| **Panel Expand** | Width/height transition | 200ms | `ease-default` |
| **Sidebar Toggle** | Width transition or instant | 200ms | `ease-default` |
| **Tab Switch** | Instant or 50ms crossfade | 50ms | `ease-default` |
| **Button Hover** | Background color transition | 100ms | `ease-default` |
| **Button Press** | Scale 0.98 | 50ms | `ease-in` |
| **Toast Enter** | Slide from right + fade | 200ms | `ease-out` |
| **Toast Exit** | Fade + slide right | 150ms | `ease-in` |
| **Row Hover** | Background color transition | 100ms | `ease-default` |
| **Inline Actions** | Opacity 0 → 1 | 100ms | `ease-default` |
| **Loading Skeleton** | Shimmer sweep | 1500ms | Linear loop |
| **Spinner** | Rotation | 1000ms | Linear loop |

### 8.5 Performance Rules

- Use `transform` and `opacity` for animations. Never animate `width`, `height`, `top`, `left`, `margin`, or `padding` — these trigger layout recalculation.
- Use `will-change: transform` on frequently animated elements (panels, modals).
- Respect `prefers-reduced-motion`: disable all non-essential animations for users who prefer reduced motion.

### 8.6 No-Animation Zones

The following must never animate:
- **Data updates**: Table rows updating, graph nodes moving, numbers changing. Update instantly.
- **Resizing**: Panel resize must follow cursor in real-time. No smooth resize.
- **Scrolling**: Instant scroll. No smooth-scroll hijacking.
- **Text input**: Cursor movement, selection. Instant.

---

## 9. Feature-Specific Patterns

### 9.1 Profile Opening

**Purpose:** View and edit entity profiles (persons, organizations, cases).

#### 9.1.1 Layout

- **Trigger:** Double-click row in table, click "Open Profile" in command palette, or click node in graph.
- **Container:** Modal (medium/large) or dedicated tab in main canvas.
- **Structure:**
  ```
  ┌─────────────────────────────────────────────┐
  │ [Avatar 48px] [Name] [Status Badge] [Edit] │
  ├─────────────────────────────────────────────┤
  │ [Tab: Overview] [Tab: History] [Tab: Associates] [Tab: Evidence] │
  ├─────────────────────────────────────────────┤
  │                                             │
  │  Content area: dense form layout or table   │
  │                                             │
  └─────────────────────────────────────────────┘
  ```

#### 9.1.2 Header

- Avatar: 48px circle, `radius-full`, border 2px `bg-border`.
- Name: `text-xl`, `text-primary`, semibold.
- Status: Badge right of name (active, pending, archived).
- Actions: Edit (primary button), Close (icon button), More actions (dropdown).

#### 9.1.3 Tab Content — Overview

- Dense form layout: 2-column grid for fields.
- Field label: `text-sm`, `text-secondary`, margin-bottom 4px.
- Field value: `text-base`, `text-primary`, monospace if applicable.
- Section dividers: full-width, `bg-border`, margin 16px 0.
- Sections: Identity, Contact, Location, Metadata.

#### 9.1.4 Tab Content — History

- Timeline view: vertical line (1px `bg-border`), events as nodes.
- Event node: 8px circle, `accent-primary` if significant, `text-tertiary` if minor.
- Event card: left or right of timeline, `bg-elevated`, `radius-md`, padding 8px.
- Event title: `text-sm` semibold.
- Event meta: `text-xs`, `text-tertiary`, timestamp.

#### 9.1.5 Tab Content — Associates

- Mini table: compact density, 28px rows.
- Columns: Name, Relation Type, Status, Actions.
- Click row: open associate profile in new tab.

#### 9.1.6 Tab Content — Evidence

- Grid of evidence items (cards or list).
- Evidence card: thumbnail + title + type badge + date.
- Click: preview in modal or open in evidence viewer.

### 9.2 Criminal Net Visualization

**Purpose:** Visualize relationships between entities in a network graph.

#### 9.2.1 Layout

- **Full-screen canvas**: The graph occupies 100% of the main canvas area.
- **Floating toolbar**: Top-left or top-center, 32px height, `bg-surface` with `radius-md`, border 1px `bg-border`, shadow `0 2px 8px rgba(0,0,0,0.3)`.
- **Floating legend**: Bottom-left, compact, toggleable.
- **Sidebar panel**: Right side, opens when node is selected, shows node details (compact profile view).
- **Minimap**: Bottom-right, 160px × 120px, `bg-surface`, border 1px `bg-border`, shows full graph with viewport rectangle.

#### 9.2.2 Graph Canvas

- Background: `bg-base`.
- Grid: subtle dot grid or line grid, `bg-border` at 30% opacity.
- Zoom: Mouse wheel or pinch gesture. Range: 10% → 500%.
- Pan: Click-drag on empty canvas or middle-mouse drag.

#### 9.2.3 Node Design

| Element | Specification |
|---------|--------------|
| **Shape** | Circle for persons, rounded rectangle for organizations, diamond for events. |
| **Size** | 24px–64px based on importance/centrality. |
| **Border** | 2px solid, color based on status. |
| **Fill** | `bg-surface` or image thumbnail. |
| **Label** | `text-xs`, `text-primary`, below node, max 24 chars then ellipsis. |
| **Status ring** | Outer ring 4px, color-coded: `accent-primary` (active), `status-warning` (flagged), `status-danger` (critical). |
| **Selection** | 2px `accent-primary` glow (box-shadow), scale 1.1. |
| **Hover** | Scale 1.05, border brightens, tooltip shows full name + key data. |

#### 9.2.4 Edge Design

- **Line**: 1px–3px based on connection strength.
- **Color**: `text-tertiary` (default), `accent-primary` (highlighted), `status-danger` (suspicious).
- **Style**: Solid (confirmed), dashed (suspected), dotted (historical).
- **Label**: `text-xs`, `text-tertiary`, centered on edge, background `bg-base` (to obscure line behind text).
- **Direction**: Arrowhead at target end, 8px.

#### 9.2.5 Interactions

| Action | Behavior |
|--------|----------|
| **Click node** | Select node, open details in right panel, highlight connected edges. |
| **Double-click node** | Open full profile in new tab. |
| **Right-click node** | Context menu: Expand, Hide, View Profile, Add Connection, Flag. |
| **Click edge** | Select edge, show relationship details in panel. |
| **Click empty canvas** | Deselect all, close detail panel. |
| **Drag node** | Move node, physics simulation pauses for that node. |
| **Scroll wheel** | Zoom in/out centered on cursor. |
| **Shift + drag** | Box selection, multi-select nodes. |
| **Space + drag** | Pan canvas (alternative to middle-mouse). |

#### 9.2.6 Toolbar Actions

- Layout algorithms: Force-directed, Hierarchical, Circular, Grid.
- Filters: By entity type, by date range, by connection strength, by status.
- Search: Find and center on node.
- Expand/Collapse: Show/hide connections beyond N degrees.
- Export: PNG, SVG, JSON.

#### 9.2.7 Animation

- **Node enter**: Scale 0 → 1, 200ms, `ease-out`.
- **Node exit**: Opacity 1 → 0, 150ms, `ease-in`.
- **Layout change**: Nodes animate to new positions, 300ms, `ease-default`.
- **No continuous animation** when idle. Physics simulation runs only during layout calculation, not continuously.

### 9.3 Search & Discovery

- **Global search bar**: In app header, 200px width, expands to 400px on focus.
- **Search results**: Dropdown, categorized (Profiles, Evidence, Cases, Commands).
- **Advanced search**: Modal with multiple criteria fields, boolean operators, date ranges.
- **Saved searches**: Star icon to save, accessible from sidebar under "Saved Queries".

### 9.4 Evidence Viewer

- **Media types**: Image, video, audio, document, raw data.
- **Layout**: Full-screen canvas with floating controls (bottom center).
- **Controls**: Play/pause, timeline scrubber, zoom, rotate, download, metadata panel toggle.
- **Metadata panel**: Right side, collapsible, shows EXIF, source, chain of custody, tags.

---

## 10. Iconography

### 10.1 Icon Style

- **Set**: Phosphor Icons (preferred), Tabler Icons, or Heroicons.
- **Style**: Outline/line style, 1.5px stroke weight. **Never filled icons** — they create visual noise in dense UIs.
- **Size**: 16px (default), 20px (toolbar), 12px (inline), 24px (empty states).
- **Color**: `text-secondary` (default), `text-primary` (active/selected), `accent-primary` (accent context), `status-*` (semantic).

### 10.2 Icon Usage Rules

| Context | Size | Color |
|---------|------|-------|
| Sidebar nav | 16px | `text-secondary` (inactive), `accent-primary` (active) |
| Toolbar buttons | 20px | `text-secondary` |
| Table row actions | 16px | `text-tertiary` (default), `status-danger` (delete) |
| Form inputs | 16px | `text-tertiary` (prefix/suffix) |
| Empty states | 48px | `text-tertiary` |
| Status indicators | 14px | `status-*` |
| Command palette | 16px | `text-secondary` |

### 10.3 Common Icons Mapping

| Concept | Icon Name | Notes |
|---------|-----------|-------|
| Search | `magnifying-glass` | |
| Filter | `funnel` | |
| Settings | `gear` | |
| Profile / User | `user` or `user-circle` | |
| Network / Graph | `graph` or `share-network` | |
| Evidence | `file-text` or `image` | Type-specific |
| Case | `folder` | |
| Add | `plus` | |
| Edit | `pencil` | |
| Delete | `trash` | Color `status-danger` |
| Close | `x` | |
| Expand | `arrows-out` | |
| Collapse | `arrows-in` | |
| Download | `download` | |
| Upload | `upload` | |
| Link | `link` | |
| Calendar | `calendar` | |
| Clock | `clock` | |
| Location | `map-pin` | |
| Alert | `warning-circle` | Color `status-warning` |
| Error | `x-circle` | Color `status-danger` |
| Success | `check-circle` | Color `status-success` |
| Info | `info` | Color `status-info` |
| Menu | `list` or `dots-three` | |
| More actions | `dots-three-vertical` | |
| Pin | `push-pin` | For pinning panels/tabs |
| Refresh | `arrow-clockwise` | |
| Fullscreen | `corners-out` | |
| Exit fullscreen | `corners-in` | |
| Undo | `arrow-u-up-left` | |
| Redo | `arrow-u-up-right` | |
| Zoom in | `magnifying-glass-plus` | |
| Zoom out | `magnifying-glass-minus` | |
| Fit to screen | `frame-corners` | |

---

## 11. Accessibility

### 11.1 Contrast

- All text must meet **WCAG AA** (4.5:1 for normal text, 3:1 for large text).
- `text-primary` on `bg-surface`: ~11:1 ✓
- `text-secondary` on `bg-surface`: ~6:1 ✓
- `accent-primary` on `bg-base`: ~5.5:1 ✓
- `status-danger` on `bg-base`: ~6:1 ✓

### 11.2 Keyboard Navigation

- **Tab order**: Logical, top-to-bottom, left-to-right.
- **Focus visible**: 2px `accent-primary` outline, offset 2px. Never rely on color alone.
- **Skip links**: "Skip to main content" link, visible only on focus.
- **Trap focus**: Modals and command palette trap focus until closed.
- **Escape key**: Closes modals, command palette, dropdowns, context menus.

### 11.3 Screen Readers

- **ARIA labels**: All icon buttons must have `aria-label`.
- **Live regions**: Toast notifications use `aria-live="polite"`.
- **Tables**: Proper `<th>` with `scope`, `caption` if needed.
- **Modals**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title.

### 11.4 Motion

- Respect `prefers-reduced-motion`:
  - Disable panel slide animations (instant open/close).
  - Disable command palette scale animation (instant).
  - Disable graph layout animation (instant reposition).
  - Keep only opacity transitions for state changes (0ms → instant).

### 11.5 Touch Targets

- Minimum touch target: 44px × 44px.
- For dense tables on touch: increase row height to 44px or make entire row tappable.

---

## 12. Implementation Stack

### 12.1 Recommended Technologies

| Layer | Recommendation | Alternatives |
|-------|---------------|--------------|
| **Framework** | React 18+ | Vue 3, Svelte |
| **Styling** | Tailwind CSS + Custom Config | CSS Modules, Styled Components |
| **Component Library** | Radix UI (headless) | Headless UI, React Aria |
| **Command Palette** | `cmdk` | `kbar`, custom implementation |
| **Layout / Docking** | `react-mosaic` or `allotment` | `react-split-pane`, `flexlayout-react` |
| **Graph Visualization** | Cytoscape.js | D3.js, Vis.js, React Flow |
| **Icons** | Phosphor React | Tabler Icons React, Heroicons |
| **Tables** | TanStack Table (React Table) | AG Grid |
| **Animation** | Framer Motion | React Spring, CSS transitions |
| **State Management** | Zustand | Redux Toolkit, Jotai |

### 12.2 Tailwind Config Reference

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'pd-base': '#0d1117',
        'pd-surface': '#161b22',
        'pd-elevated': '#21262d',
        'pd-border': '#30363d',

        // Text
        'pd-text-primary': '#c9d1d9',
        'pd-text-secondary': '#8b949e',
        'pd-text-tertiary': '#6e7681',
        'pd-text-inverse': '#0d1117',

        // Accent
        'pd-accent': '#58a6ff',
        'pd-accent-hover': '#79c0ff',
        'pd-accent-subtle': 'rgba(88, 166, 255, 0.15)',

        // Status
        'pd-success': '#3fb950',
        'pd-warning': '#d29922',
        'pd-danger': '#f85149',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'pd-xs': ['11px', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        'pd-sm': ['12px', { lineHeight: '1.5' }],
        'pd-base': ['13px', { lineHeight: '1.5' }],
        'pd-md': ['14px', { lineHeight: '1.5' }],
        'pd-lg': ['16px', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
        'pd-xl': ['20px', { lineHeight: '1.3', letterSpacing: '-0.02em' }],
        'pd-2xl': ['24px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
      },
      spacing: {
        'pd-1': '4px',
        'pd-2': '8px',
        'pd-3': '12px',
        'pd-4': '16px',
        'pd-5': '20px',
        'pd-6': '24px',
        'pd-8': '32px',
      },
      borderRadius: {
        'pd-sm': '4px',
        'pd-md': '6px',
        'pd-lg': '8px',
      },
      transitionTimingFunction: {
        'pd-snap': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
}
```

### 12.3 CSS Variables (Vanilla CSS Fallback)

```css
:root {
  --pd-base: #0d1117;
  --pd-surface: #161b22;
  --pd-elevated: #21262d;
  --pd-border: #30363d;

  --pd-text-primary: #c9d1d9;
  --pd-text-secondary: #8b949e;
  --pd-text-tertiary: #6e7681;
  --pd-text-inverse: #0d1117;

  --pd-accent: #58a6ff;
  --pd-accent-hover: #79c0ff;
  --pd-accent-subtle: rgba(88, 166, 255, 0.15);

  --pd-success: #3fb950;
  --pd-warning: #d29922;
  --pd-danger: #f85149;

  --pd-backdrop: rgba(13, 17, 23, 0.75);

  --pd-duration-fast: 50ms;
  --pd-duration-normal: 150ms;
  --pd-duration-medium: 200ms;
  --pd-duration-slow: 300ms;

  --pd-ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --pd-ease-out: cubic-bezier(0, 0, 0.2, 1);
  --pd-ease-snap: cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## 13. Anti-Patterns

### 13.1 Strictly Prohibited

| Anti-Pattern | Why | Correct Approach |
|-------------|-----|-----------------|
| **Pure white backgrounds** | Destroys dark adaptation, causes eye strain. | Use `bg-base` (#0d1117) or `bg-surface` (#161b22). |
| **Large border radius** | Breaks the technical, precise aesthetic. | Max 8px for large elements, 4px for buttons/inputs. |
| **Drop shadows for elevation** | In dark UI, shadows are invisible. Shadows imply light source which doesn't exist. | Use lighter backgrounds (`bg-elevated`) and borders for elevation. |
| **Gradient backgrounds** | Decorative, adds visual noise, reduces perceived performance. | Solid colors only. |
| **Multiple accent colors** | Dilutes meaning, creates carnival effect. | One accent color (`#58a6ff`). Status colors only for semantic meaning. |
| **16px+ default body text** | Wastes space, breaks density. | 13px default, 14px max for body. |
| **Generous whitespace** | Assumes user is a casual consumer. This is professional software. | Compact spacing, 4px–8px gaps. |
| **Hamburger menus on desktop** | Hides navigation, violates 3-layer rule. | Persistent sidebar, command palette. |
| **Animated backgrounds / particles** | Distracting, unprofessional, performance cost. | Static, solid backgrounds. |
| **Scroll hijacking** | Breaks user expectation, causes disorientation. | Native scroll behavior, custom scrollbar styling only. |
| **Modal chains (modal on modal)** | Disorienting, hard to navigate back. | Use sidebar panels, tabs, or replace modal content. |
| **Missing keyboard shortcuts** | Forces mouse usage, slows power users. | Every action must have a keyboard path. |
| **Touch-optimized spacing on desktop** | 44px buttons waste space for mouse users. | 28px default buttons, 24px compact. Touch targets only on actual touch devices. |
| **Loading spinners on every action** | Creates anxiety, feels slow. | Optimistic UI, skeleton screens, or instant feedback. |
| **Color-only status indication** | Fails for colorblind users. | Combine color + icon + text label. |
| **Blinking cursors / alerts** | Causes stress, feels like an error. | Static indicators, subtle pulse at most. |

### 13.2 Common Mistakes in Dark UI

1. **Using pure black (#000000)**: Creates excessive contrast and makes colors appear oversaturated. Always use `#0d1117` or similar dark gray.
2. **Inverting a light theme**: Dark UI is not just "light UI with inverted colors." Contrast relationships change — what works in light often fails in dark.
3. **Too much gray**: Without accent color, the UI feels lifeless. Use `accent-primary` sparingly but consistently.
4. **Ignoring hover states**: In dark UI, hover states are critical for discoverability. Every interactive element must have a visible hover state.
5. **Poor focus indicators**: Dark blue focus rings on dark backgrounds are invisible. Use `accent-primary` with offset.

---

## 14. Checklist for New Features

Before shipping any new feature, verify:

- [ ] All colors use tokens from Section 2.1 (no hardcoded hex values).
- [ ] All text uses the type scale from Section 2.2 (no random font sizes).
- [ ] All spacing uses the 4px grid from Section 2.3.
- [ ] Every action is reachable within 3 layers of navigation (Section 4.1).
- [ ] Every frequent action has a keyboard shortcut (Section 4.2.2).
- [ ] The feature is accessible via Command Palette (Section 6).
- [ ] All interactive elements have visible hover and focus states.
- [ ] Data tables use compact density where appropriate (Section 7.2).
- [ ] Monospace font is used for all machine data (Section 7.5).
- [ ] Animations use tokens from Section 8.2 and 8.3.
- [ ] No animation exceeds 300ms duration.
- [ ] `prefers-reduced-motion` is respected.
- [ ] All icon buttons have `aria-label`.
- [ ] Focus is visible and logical.
- [ ] No anti-patterns from Section 13 are present.

---

## 15. Glossary

| Term | Definition |
|------|-----------|
| **Pro Dark Interface (PDI)** | This design system. A dark, high-density, keyboard-first UI for professional tools. |
| **Command Palette Interface (CPI)** | The interaction model where `Cmd+K` or `Cmd+Shift+P` opens a searchable command interface. |
| **IDE-Style Layout** | Dockable panels, tabbed documents, sidebar navigation, status bar — as seen in VS Code. |
| **High-Density Information UI** | Maximizing data per pixel through compact spacing, inline actions, and progressive disclosure. |
| **The Three-Layer Rule** | Every action must be reachable within 3 navigation layers: Global → Contextual → Action. |
| **Canvas Supremacy** | The principle that the main work area should never be obstructed by UI chrome. |
| **Keyboard Sovereignty** | The principle that keyboard access is primary; mouse is secondary. |
| **Functional Honesty** | The principle that every visual element must serve a functional purpose; no decoration. |

---

*End of Document*

**Usage Note:** This document is designed to be used as an agent skill or design system reference. When implementing UI components, refer to the specific section for exact values. When in doubt, prioritize density, keyboard access, and functional clarity over aesthetic embellishment.
