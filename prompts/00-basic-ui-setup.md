Set up the basic UI foundation for the Public Equity™ doorman.

Create three pages with minimal, terse aesthetic:

## Design System

- Background: Black (#000000)
- Text: White (#FFFFFF)
- Font: System font stack (no custom fonts yet)
- No borders, shadows, or decorative elements
- Maximum restraint

## Pages to Create

### 1. Landing Page (app/page.tsx)

Simple holding page:

- Centered text: "PUBLIC EQUITY™"
- Subtext: "BUYING POWER"
- Link: "Enter" → routes to /doorcheck
- That's it. Nothing else.

### 2. Chat Interface (app/doorcheck/page.tsx)

- Messages stacked vertically
- Bot messages: left-aligned
- User messages: right-aligned
- Input: Bottom of screen, full width, no border, just underline
- No timestamps, no avatars, no metadata visible
- Auto-scroll to latest message
- No "send" button - Enter key submits

Visual reference:

```
What brings you here, and what do you think you would add?

                                                I want to apply

What would you protect here?

                                    Community, mostly
```

### 3. Email Collection (app/doorcheck/access/page.tsx)

- Centered on screen
- Single line: "Email."
- Input field below
- Submit button: Just a border, "Submit" text
- Success state: Replace form with "Noted."

## Technical Requirements

- Use Next.js App Router
- No component library (no shadcn, no MUI, nothing)
- Just HTML, CSS, TypeScript
- Mobile responsive (just scale, don't redesign)
- No loading spinners (just disable input)

## Files to Create

1. app/page.tsx
2. app/doorcheck/page.tsx
3. app/doorcheck/access/page.tsx
4. app/globals.css (minimal reset + black/white theme)

Start with static UI only - no functionality yet. Just the visual shell.
Make it feel like a terminal conversation, not a polished chat app.
