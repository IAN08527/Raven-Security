# RAVEN — Design System & UI Specification

**Version:** 1.0  
**Product:** Raven Intelligence Platform  
**Design direction:** Dark operational intelligence workspace inspired by the supplied references and generated RAVEN UI concepts.

---

## 1. Design Intent

RAVEN is an intelligence and investigation platform for exploring cases, people, evidence, relationships, locations, communications, and camera activity.

The interface should feel like a **professional intelligence workstation**, not a consumer dashboard or generic SaaS product.

The visual language combines:

- The restrained dark dashboard structure of the primary reference.
- The vertical navigation pattern of the secondary reference.
- A dense, evidence-oriented intelligence workspace.
- A network graph as a first-class investigative surface.
- A dedicated CCTV workspace with operational camera controls.
- Clear information hierarchy with minimal decoration.
- High information density without visual clutter.
- Strong separation between navigation, workspace, evidence, and contextual detail.

The interface should communicate:

> **Observe → Investigate → Connect → Verify → Act**

RAVEN must never visually imply certainty where the underlying system only has a candidate, prediction, or model-generated result.

---

# 2. Core Visual Principles

## 2.1 Dark by Default

RAVEN uses a dark interface throughout the application.

The background should be close to black rather than pure black. Panels are only slightly lighter than the application background, producing subtle depth without relying on gradients.

Use:

- Near-black application background
- Charcoal navigation surfaces
- Slightly lighter content panels
- Very subtle borders
- Off-white primary text
- Muted gray secondary text
- Restrained semantic accents

Avoid:

- Bright white backgrounds
- Large gradient backgrounds
- Glassmorphism
- Excessive glow
- Decorative shadows
- Excessive rounded cards
- Neon-heavy cyberpunk styling

---

## 2.2 Information First

Every visual element must have an operational purpose.

Prefer:

- Tables
- Lists
- Compact metrics
- Graphs
- Maps
- Evidence previews
- Status indicators
- Timelines
- Contextual panels

Avoid:

- Decorative illustrations
- Large empty hero sections
- Marketing-style feature cards
- Excessive icons
- Unnecessary animation

The UI should remain useful when the user is working with hundreds or thousands of records.

---

## 2.3 Calm Density

RAVEN should be information-dense but calm.

Dense screens should use:

- Consistent spacing
- Strong alignment
- Small but readable typography
- Clear section headings
- Thin separators
- Compact controls
- Predictable panel placement

Do not solve information density by making text microscopic.

---

## 2.4 Evidence Before Assumption

Where the system displays analytical results, the UI should distinguish:

- Confirmed
- Proposed
- Inferred
- Pending review
- Rejected
- Tampered
- Unavailable

Model output must never visually look identical to confirmed case data.

---

# 3. Color System

The palette is derived primarily from the supplied dark reference image and the generated RAVEN concepts.

## 3.1 Base Colors

```text
App Background       #151514
Primary Surface      #1B1B19
Secondary Surface    #20201E
Elevated Surface     #252522
Input Surface        #171716
Border               #30302D
Border Subtle        #272724

Primary Text         #E8E5DD
Secondary Text       #A5A29A
Muted Text            #706E68
Disabled Text         #50504B
```

The palette should remain neutral and slightly warm rather than blue-black.

---

## 3.2 Accent Colors

Accents are restrained and semantic.

```text
Green / Confirmed     #4FAE79
Orange / Attention    #D89A45
Red / Critical        #D8665C
Blue / Information    #668DBA
Yellow / Warning      #C9A653
Purple / Secondary    #8273A8
```

Accent colors should occupy small areas:

- Status dots
- Graph node types
- Trend indicators
- Alerts
- Selected states
- Progress indicators
- Important labels

Never flood an entire panel with an accent color.

---

## 3.3 Semantic Status

| State | Visual treatment |
|---|---|
| Confirmed | Muted green |
| Active | Green |
| Processing | Amber/orange |
| Pending review | Orange |
| Warning | Yellow/orange |
| Critical | Red |
| Rejected | Muted red |
| Offline | Red |
| Informational | Blue |
| Unknown | Neutral gray |
| Tampered | Red + highly visible warning state |

Status should use both color and text/icon. Never rely on color alone.

---

# 4. Typography

The interface should use a modern, highly readable sans-serif UI font.

Recommended:

```text
Inter
IBM Plex Sans
SF Pro / system sans-serif
```

For selected large page titles and certain editorial headings, a restrained serif can be used if it matches the implementation direction, but the default application typography should remain sans-serif.

## Type Scale

```text
Page Title           24–30px
Section Title        16–18px
Card Title           14–16px
Body                 13–14px
Secondary            12–13px
Metadata             11–12px
Compact Labels       10–11px
```

Use font weight to create hierarchy rather than excessive size.

Recommended weights:

```text
Regular       400
Medium        500
Semibold      600
```

Avoid extremely bold headings.

---

# 5. Application Shell

The application uses a persistent vertical navigation system.

## 5.1 Layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ RAVEN     Global Search                         Notifications  User │
├───────────────┬──────────────────────────────────────────────────────┤
│               │                                                      │
│  HOME         │                                                      │
│  CASES        │                  MAIN WORKSPACE                      │
│  INGESTION    │                                                      │
│  GRAPH        │                                                      │
│  CCTV         │                                                      │
│  SEARCH       │                                                      │
│  REPORTS      │                                                      │
│  AUDIT        │                                                      │
│  SETTINGS     │                                                      │
│               │                                                      │
│               │                                                      │
│  User         │                                                      │
│  System       │                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
```

The sidebar is always visually distinct from the workspace.

---

## 5.2 Sidebar

The sidebar should be approximately:

```text
Width: 160–190px
```

It contains:

1. RAVEN logo/wordmark
2. Primary navigation
3. Optional case/context indicator
4. Current user
5. System health indicator
6. Logout/control area

Navigation items:

```text
Home
Ingestion
Cases
Graph
CCTV
Search
Reports
Audit
Settings
```

Depending on role, some items may be hidden or disabled.

---

## 5.3 Active Navigation

The selected item uses:

- Slightly elevated surface
- Subtle border
- Small icon emphasis
- High-contrast text

Do not use large colored fills.

---

# 6. Top Bar

The top bar provides global context rather than application navigation.

Elements:

- Global search
- Keyboard shortcut hint
- Notifications
- Current user
- Role
- System status

Global search should support queries across:

- People
- Organisations
- Locations
- Documents
- Cases
- Phone numbers
- Identifiers
- Communications

---

# 7. Dashboard / Home

The home screen follows the structure of the primary supplied reference: compact metrics at the top followed by multiple analytical sections.

## 7.1 Header

```text
Good morning, Officer Sharma.
Here's the current operational situation.
```

Right side:

```text
Date / Time
```

---

## 7.2 Metric Strip

Use 4–6 compact metric panels.

Example:

```text
Active Cases        24
Persons of Interest 1,284
Documents Ingested  3,921
Cameras Online      48
Pending Reviews     156
Alerts              12
```

Each metric may include a small trend indicator.

Metrics must remain compact. They are context, not the main content.

---

## 7.3 Main Dashboard Grid

Recommended structure:

```text
┌──────────────────────────────┬──────────────────┬───────────────┐
│                              │                  │               │
│       Operational Map        │ Recent Activity  │ Active Cases  │
│                              │                  │               │
├──────────────────────────────┴──────────────────┤               │
│                                                 │ Camera Status  │
│ Ingestion / Review Queue     Network Activity  │               │
│                                                 │ Key Locations  │
└─────────────────────────────────────────────────┴───────────────┘
```

The dashboard should prioritize operational activity over decorative analytics.

---

# 8. Case Workspace

A case is the main container for investigation work.

## Header

```text
Cases / Operation Blackridge

Operation Blackridge     [Active]
```

Actions:

- Share
- Case actions
- Add data
- Export where permitted

Tabs:

```text
Overview
Evidence
Entities
Network
CCTV
Communications
Timeline
Notes
Analytics
Audit
```

---

## Case Overview

Display:

- Case summary
- Classification
- Assigned officers
- Team
- Creation date
- Last update
- Key metrics
- Key locations
- Recent evidence
- Case timeline

Use a two-column structure.

---

# 9. Network Graph

The graph is one of the primary RAVEN experiences.

The visual language should be inspired by the supplied graph reference: dark canvas, restrained colored nodes, thin relationship lines, contextual labels, and a persistent entity detail panel.

## 9.1 Graph Layout

```text
┌─────────────┬───────────────────────────────────────┬───────────────┐
│ Graph Tools │                                       │ Entity        │
│             │             NETWORK GRAPH              │ Details       │
│ Legend      │                                       │               │
│             │       ○──────○                       │ Overview      │
│             │      /        \                      │ Relations     │
│             │     ○    ●────○                      │ Evidence      │
│             │      \   │                           │ Activity      │
│             │       ○──○                            │               │
├─────────────┴───────────────────────────────────────┴───────────────┤
│ Related Entities │ Evidence │ Recent Activity                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9.2 Graph Canvas

The graph canvas should have minimal visual chrome.

Background:

```text
#151514
```

Nodes should use semantic outlines:

```text
Person          Green / blue outline
Organisation    Green
Location        Yellow/orange
Document        Blue
Event           Red
Phone           Neutral / blue
Vehicle         Neutral
```

The central selected node may use a stronger outline and subtle ring.

---

## 9.3 Graph Relationships

Edges should be thin.

Relationship types may use:

- Solid line — confirmed/strong association
- Dashed line — indirect or weaker relationship
- Colored line — relationship category
- Arrow — directional relationship

Relationship labels appear only when useful.

Avoid making every label permanently visible on large graphs.

---

## 9.4 Graph Controls

Compact controls:

```text
Zoom +
Zoom -
Fit
Reset
Layers
Filters
Expand
```

Additional controls:

```text
Entity type
Relationship type
Evidence only
Date range
Confidence
Case scope
```

---

## 9.5 Entity Detail Panel

When a node is selected, open a persistent right-side contextual panel.

Sections:

```text
Entity identity
Overview
Relationships
Evidence
Activity
Notes
Quick actions
```

Example:

```text
Rohan Mehta
Person
High Priority

Full Name
Aliases
Identifiers
Associated Cases
Risk Score

Key Relationships
Evidence
Recent Activity
```

The graph should not disappear when the detail panel opens.

---

# 10. CCTV Monitoring

The CCTV experience should visually borrow from the third supplied reference.

It is intentionally more operational than the rest of the application.

## 10.1 Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ CCTV Monitoring                          Camera / Session  │
├───────────────────────────────────────┬─────────────────────┤
│                                       │ Camera Details       │
│                                       │ Status               │
│             LIVE VIDEO                │ Resolution           │
│                                       │ FPS                  │
│        detection overlays             │ Detections           │
│                                       │ Alerts               │
├───────────────────────────────────────┴─────────────────────┤
│ Timeline / Playback / Capture Controls                       │
├─────────────────────────────────────────────────────────────┤
│ Camera 01 │ Camera 02 │ Camera 03 │ Camera 04 │ Camera 05   │
└─────────────────────────────────────────────────────────────┘
```

---

## 10.2 Main Feed

The video should dominate the screen.

Display overlays:

- Camera name
- LIVE indicator
- Timestamp
- Detection bounding boxes
- Track IDs
- Confidence
- Optional target lock
- FPS

Do not obscure the footage with excessive UI.

---

## 10.3 Camera Detail Panel

Show:

```text
Camera
Location
Status
Resolution
FPS
Uptime
Current detections
Target state
```

Detection list:

```text
Person       0.92
Person       0.87
Vehicle      0.76
```

---

## 10.4 Playback Controls

Controls should be compact:

```text
Play / Pause
Record
Timeline
Previous / Next
Screenshot
Fullscreen
Mark Event
```

The case clock should be visible for recorded footage.

---

## 10.5 Camera Strip

A horizontal thumbnail strip allows quick camera switching.

Each camera thumbnail should show:

- Preview
- Camera name
- Status
- Selected state

Offline cameras should be visually obvious but not dominate the interface.

---

# 11. Document Ingestion

The ingestion interface should feel like an operational queue, not a marketing upload page.

## Layout

```text
┌──────────────────────────────┬─────────────────────────────┐
│ Drop files here              │ Ingestion Settings          │
│                              │                             │
│        Upload               │ Case                        │
│                              │ Document Type               │
│                              │ Provenance                  │
│                              │                             │
│                              │ Start Ingestion             │
└──────────────────────────────┴─────────────────────────────┘

Recent Ingestions
──────────────────────────────────────────────────────────────
File        Type     Case      Status          Entities   Date
```

---

## Statuses

```text
Queued
Processing
Recognising
Extracting
Needs Review
Completed
Failed
```

Every failure must expose the reason and provide retry/recovery where supported.

---

# 12. Document Review

Document review is an evidence-centric workspace.

## Layout

```text
┌──────────────┬──────────────────────────────┬───────────────┐
│ Documents    │ Document Viewer              │ Extracted     │
│              │                              │ Entities      │
│ file list    │ scanned page / PDF           │               │
│              │                              │ confidence    │
│              │                              │ review state   │
└──────────────┴──────────────────────────────┴───────────────┘
```

The original document remains visible beside extracted information.

---

## Evidence Highlighting

When an entity is selected:

- Highlight the corresponding source span.
- Show page number.
- Show confidence.
- Show provenance.
- Provide access to the original evidence.

Never display an extracted entity without a path back to its source.

---

# 13. Global Search

Search should be a first-class workspace.

Header:

```text
Search across cases, people, organisations, locations, documents...
```

Filters:

```text
All
People
Organisations
Locations
Documents
Communications
CCTV
Cases
```

Results should show:

- Entity/document name
- Type
- Relevant case
- Matching context
- Evidence count
- Last activity

Search results should be compact and scannable.

---

# 14. Entity Profile

Entity profiles provide a focused view outside the graph.

Recommended structure:

```text
Entity Header
├── Identity
├── Overview
├── Associations
├── Evidence
├── Locations
├── Communications
├── Timeline
└── Related Cases
```

A profile may contain:

- Basic information
- Known aliases
- Identifiers
- Associated cases
- Risk/context indicators
- Related media
- Quick actions

Do not present an analytical score as a factual identity assertion.

---

# 15. Map View

Maps use the locally hosted basemap.

The visual style should match the dark application theme.

Use:

- Dark map
- Minimal labels
- Small semantic markers
- Clustered points
- Selected-location emphasis
- Case/camera layers

Layers may include:

```text
Camera locations
Case locations
Confirmed sightings
Communication locations
Known locations
Incidents
```

The map should remain visually subordinate to the investigation data.

---

# 16. Timeline

The timeline displays chronological case activity.

Example:

```text
16 Feb 2025

21:14   CCTV match proposed
        Camera 03
        Confidence 0.87

19:03   Document ingested
        Seized_Letter.pdf

17:26   Entity added
        Shree Traders

14:11   Communication record processed
```

Timeline entries should link back to their evidence.

---

# 17. Reports

Reports use a simple table-oriented layout.

Columns:

```text
Name
Type
Case
Generated By
Date
Status
Actions
```

Actions may include:

- View
- Generate
- Export
- Archive

Do not use large report cards.

---

# 18. Audit

The audit interface is intentionally utilitarian.

Columns:

```text
Timestamp
User
Action
Resource
Details
Status
```

Example actions:

```text
Document ingested
Graph updated
Evidence viewed
Candidate confirmed
Candidate rejected
Entity merged
Annotation added
Report exported
```

Audit entries must be attributable to the authenticated user.

---

# 19. Settings & Administration

Settings should use the same sidebar architecture.

Sections:

```text
Users
Roles & Permissions
Cameras
Engine Nodes
Form Templates
System
Audit Logs
```

Administration must not visually expose case content to roles that cannot access it.

---

# 20. Components

## Cards

Cards should be:

- Subtle
- Compact
- Low-radius
- Thin-bordered
- Dark-on-dark

Recommended radius:

```text
6–10px
```

Avoid excessive pill-shaped containers.

---

## Buttons

Primary:

- Dark elevated surface
- Clear border
- Strong text

Secondary:

- Transparent/subtle surface
- Thin border

Danger:

- Neutral surface with restrained red semantic treatment

Buttons should not use gradients.

---

## Inputs

Inputs should use:

```text
Background: #171716
Border: #30302D
Text: #E8E5DD
Placeholder: #706E68
Focus: subtle accent border
```

---

## Tables

Tables are a major RAVEN component.

Use:

- Compact rows
- Thin dividers
- Sticky headers where appropriate
- Hover state
- Status indicators
- Right-aligned numeric values
- Consistent column spacing

Avoid heavy boxed cells.

---

## Status Indicators

Use small dots, labels, or icons.

Example:

```text
● Online
● Processing
● Completed
● Needs Review
● Offline
```

Keep indicators compact.

---

# 21. Icons

Use one consistent icon family.

Recommended style:

- Lucide
- Phosphor
- Similar thin-line icon system

Icons should generally be:

```text
14–18px
```

Avoid mixing filled and outlined icon styles without a clear reason.

---

# 22. Spacing System

Use a predictable spacing scale:

```text
4px
8px
12px
16px
20px
24px
32px
40px
48px
```

Default content padding:

```text
24px
```

Compact panels:

```text
16px
```

Large workspace sections:

```text
24–32px
```

---

# 23. Borders and Depth

RAVEN should rely more on borders and tonal differences than shadows.

Preferred hierarchy:

```text
Background
    ↓
Surface
    ↓
Elevated Surface
    ↓
Selected Surface
```

Use shadows sparingly.

Avoid:

- Strong drop shadows
- Floating glass panels
- Excessive blur
- Gradient borders

---

# 24. Responsive Behavior

The primary target is a desktop investigation workstation.

Recommended breakpoints:

```text
Large desktop     1440px+
Desktop           1200–1439px
Compact desktop   1024–1199px
```

At smaller widths:

- Collapse sidebar where appropriate.
- Convert right detail panels into drawers.
- Reduce dashboard columns.
- Preserve critical graph and CCTV controls.
- Never make evidence unreadable.

Mobile is not the primary design target.

---

# 25. Motion

Motion should be subtle and functional.

Allowed:

- Panel transitions
- Sidebar state changes
- Graph selection
- Loading indicators
- CCTV playback transitions
- Search result updates
- Toast notifications

Animation duration:

```text
120–220ms
```

Avoid:

- Continuous decorative animation
- Pulsing UI everywhere
- Large page transitions
- Excessive graph animation

Live CCTV indicators may animate subtly to communicate active state.

---

# 26. Graph Interaction Principles

Graph interactions should feel analytical rather than playful.

Interactions:

```text
Click node       → Select entity
Double click     → Expand relationships
Drag             → Reposition
Scroll           → Zoom
Right click      → Context actions
Click edge       → Evidence relationship
```

When an edge is selected, display:

- Relationship type
- Weight
- Evidence count
- Evidence sources
- Dates
- Provenance
- Explanation

---

# 27. CCTV Interaction Principles

Selecting a detected track should:

1. Highlight the track.
2. Display its local track ID.
3. Allow officer lock-on.
4. Present relevant candidate sightings.
5. Keep confirmation explicitly human-driven.

Candidate matches must be visually presented as **proposals**, not confirmed identities.

---

# 28. Evidence Interaction Principles

Every important analytical object should support:

```text
View Evidence
View Source
View Page
View Span
View Provenance
View Audit
```

Evidence should open in context without unexpectedly navigating away from the current investigation.

---

# 29. Empty States

Empty states should be operational and concise.

Example:

```text
No evidence found

No evidence matches the current filters.
Try widening the date range or removing a filter.
```

Avoid illustrations and marketing copy.

---

# 30. Loading States

Prefer skeleton rows/panels for predictable content.

For analytical processes:

```text
Processing document...
Recognising handwriting...
Extracting entities...
Synchronising graph...
```

Long-running tasks should expose meaningful progress whenever available.

---

# 31. Error States

Errors should explain:

1. What happened
2. What was affected
3. Whether data was committed
4. What the user can do next

Example:

```text
Document ingestion failed

The document was hashed and stored, but entity extraction
did not complete.

Status: Needs Review

[Open Review] [Retry]
```

Never use generic:

```text
Something went wrong.
```

as the only explanation.

---

# 32. Tamper State

Tamper detection is a high-priority visual state.

When evidence fails verification:

```text
TAMPER DETECTED

Stored document hash does not match the anchored hash.

Stored:
...

Anchored:
...

Derived entities and relationships have been excluded
from analysis until the discrepancy is resolved.
```

Use restrained red, not a full-screen red treatment.

---

# 33. Role-Based UI

The design must support the four defined roles:

```text
Investigating Officer
Intelligence Analyst
Forensic Auditor
Administrator
```

The interface should adapt actions to permissions.

Do not merely hide permissions behind disabled buttons.

For example:

- Investigating Officer → confirmation and case actions
- Intelligence Analyst → network and analytical views
- Forensic Auditor → read-only evidence and audit verification
- Administrator → users, cases, cameras, templates, system health

---

# 34. Accessibility

Minimum requirements:

- Text must remain readable against dark surfaces.
- Do not rely on color alone.
- Keyboard focus must be visible.
- Interactive targets should be sufficiently large.
- Graph nodes must have textual/contextual alternatives.
- CCTV alerts should use labels/icons as well as color.
- Tables must maintain clear headers.
- Motion should respect reduced-motion preferences.

---

# 35. Screen Inventory

The first implementation should include the following major screens:

```text
01  Login
02  Home / Dashboard
03  Case Overview
04  Network Graph
05  CCTV Monitoring
06  Document Ingestion
07  Document Review
08  Entity Profile
09  Global Search
10  Map View
11  Case Timeline
12  Reports
13  Audit Logs
14  Settings
15  User Management
16  System Health
```

Not every screen needs an independent visual language. They should feel like different workspaces inside one consistent RAVEN shell.

---

# 36. Design Do / Don't

## Do

- Use dark charcoal surfaces.
- Use thin borders.
- Keep layouts structured.
- Use restrained semantic colors.
- Prioritize evidence.
- Use dense but readable tables.
- Keep graph interactions analytical.
- Make CCTV feeds visually dominant.
- Preserve persistent navigation.
- Keep contextual information close to the active object.
- Clearly distinguish proposed vs confirmed information.

## Don't

- Don't use gradients as a primary visual treatment.
- Don't use excessive glassmorphism.
- Don't use neon cyberpunk styling.
- Don't use huge rounded cards.
- Don't fill the interface with bright accent colors.
- Don't hide evidence behind multiple navigation levels.
- Don't make model predictions look like facts.
- Don't automatically assert identity.
- Don't create decorative dashboards with no operational value.
- Don't sacrifice readability for density.

---

# 37. Overall Visual Reference

The final product should feel like:

```text
Professional intelligence workstation
        +
Evidence management system
        +
Network analysis environment
        +
CCTV operations console
```

The visual hierarchy should remain consistent across all of them.

The desired impression is:

**quiet, precise, investigative, dense, trustworthy, operational.**

RAVEN should look like a system built for analysts who spend hours inside it—not a visual demonstration built to impress for thirty seconds.
