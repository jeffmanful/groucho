# Epic: Multi-step project creation wizard

**Goal:** Creating a **project** (a Groucho gate configuration) must feel **deliberate** — not a one-click action. Operators should understand scope: branding, outcomes, webhooks, and keys affecting production traffic.

**Related:** [PRD §6.6](./PRD.md), Phase 2 in [roadmap-github-issues.md](./roadmap-github-issues.md)

---

## 1. UX principles

1. **Friction by design** — Minimum **4 steps**; cannot finish in under ~90 seconds of intentional reading (no hard timer required; use required fields + confirmation).  
2. **Progress persistence** — Save draft `project` row with `status = draft` or store wizard state server-side keyed by `user_id` + `org_id`.  
3. **Reveal API key once** — Final screen shows plaintext key + copy button + “I have stored this safely” checkbox before dismiss.  
4. **Escape hatch** — “Save as draft” on steps 2–4; “Cancel” with confirm if dirty.

---

## 2. Step breakdown

### Step 1 — Intent and naming

**Screen title:** “What are you protecting?”

| Field | Type | Validation | Copy (helper) |
|-------|------|--------------|----------------|
| Project display name | text | 2–64 chars, trim | “Shown in your dashboard only.” |
| URL slug | text | `^[a-z0-9][a-z0-9-]{1,30}$`, unique per org | “Used in API paths and logs. Cannot change later (v1).” |
| Primary use case | select | one of: Community gate, B2B trial, Event access, Other | “Helps us tune defaults and docs.” |

**Mock (wireframe description):**

- Full-width dark panel; left: step indicator `1 — Scope`.  
- Right: form fields stacked; slug shows live preview `api.groucho.dev/v1/projects/{slug}/...` (example only).

**Primary CTA:** Continue (disabled until valid).

---

### Step 2 — Gate behaviour

**Screen title:** “How should the door behave?”

| Field | Type | Validation |
|-------|------|------------|
| Environment | radio | `test` \| `live` (default test) |
| Default mode for sessions | radio | `live` \| `dry-run` (default dry-run in test env) |
| Persona | select from `project_personas` templates OR “Start from Lou template” | required |
| Acceptance threshold | numeric slider, `0–1` | Must be greater than review threshold; default `0.80` |
| Review threshold | numeric slider, `0–1` | Must be lower than acceptance threshold; default `0.55` |
| Automatically accept top band | switch | Default off |
| Automatically decline below threshold | switch | Default off; independent from automatic acceptance |

**Optional advanced (collapsed accordion):**

- Max turns (default 4).

The decision controls must explain that Groucho supplies a suitability score while
the client owns the thresholds and automatic actions. Enabling either switch shows
a warning that the corresponding score band will create immutable decisions for
real applicants. The two switches must never be visually or logically coupled.

**Friction:** Accordion label “Advanced conversation settings” for max turns. Decision
automation remains visible rather than hidden because it changes applicant access.

**Mock:** Two-column layout: left summary card of Step 1; right form. Sticky footer with Back / Continue.

---

### Step 3 — Integrations (optional but encouraged)

**Screen title:** “Where should outcomes go?”

| Field | Type | Validation |
|-------|------|------------|
| Webhook URL | URL optional | https only, max length |
| Webhook events | multi-select | presets: `session.completed`, `verdict.created` |
| Generate signing secret | button | Creates `webhooks.secret` server-side; show once like API key |

**Copy:** “Webhooks let your CRM or Slack react the moment someone passes or is redirected. You can add this later in project settings.”

**Mock:** Empty state illustration + “Skip for now” secondary link (records `webhooks` row inactive vs no row — product choice: prefer **no row** if skipped).

---

### Step 4 — Review and commit

**Screen title:** “Review and create”

Read-only summary: name, slug, environment, persona, suitability thresholds,
automatic-action state, webhook host (masked), and mode defaults.

| Control | Behaviour |
|---------|-----------|
| Checkbox | “I understand this project will accept API traffic in **{env}**.” (required) |
| Checkbox | “I have permission to run this gate on behalf of **{org name}**.” (required) |

**Primary CTA:** Create project (only enabled when both checked).

**On success:** Navigate to Step 5 (modal or new route) — **Key ceremony**.

---

### Step 5 — API key ceremony (post-create)

**Not numbered in progress bar** — modal overlay “Your project API key”.

| Element | Behaviour |
|---------|-----------|
| Key display | `gk_test_xxxx` or `gk_live_xxxx` monospace, large |
| Copy button | Copies full string |
| Warning | “This is the only time we show the full key.” |
| Checkbox | “I have copied the key to a secure location.” |
| CTA | Continue to project dashboard (disabled until checkbox) |

**Mock:** Modal dims background; confetti **off** (brand is serious); subtle success checkmark.

---

## 3. Validation and API contract

- **Create project** `POST /internal/orgs/:orgId/projects` (platform session auth) — returns `project` + **one** `api_key` plaintext in body **only** on this response.  
- Subsequent listings show `key_prefix` + `label` + `created_at` only.

---

## 4. Acceptance criteria (wizard epic)

- [ ] User cannot reach key screen without completing review checkboxes.  
- [ ] Slug conflict returns inline error without losing other field values.  
- [ ] Refresh mid-wizard restores draft (if draft persistence implemented).  
- [ ] Closing key modal without checkbox shows browser `beforeunload` warning if trying to leave (optional).  
- [ ] Analytics event: `project_wizard_started`, `project_wizard_step_N`, `project_created`.
- [ ] Both automatic actions are off unless the operator explicitly enables them.
- [ ] Review threshold cannot equal or exceed the acceptance threshold.
- [ ] Review screen states which score bands remain pending and which create automatic decisions.

---

## 5. Out of scope (same epic)

- Billing plan selection.  
- Custom domain for embedded widget.  
- Import persona from file.
