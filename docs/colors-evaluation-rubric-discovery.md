# COLORS Evaluation Rubric Discovery

Updated: 2026-07-30

This document captures what is still needed from COLORS before Groucho can evaluate forum applications with a reliable, auditable rubric.

The persona brief gives strong tone and values guidance. The missing product work is turning those values into evidence rules: what counts as enough signal, what counts against an applicant, what should stay neutral, and when Groucho should stop asking.

## Confirmed Groucho Rules

- Groucho should produce one private advisory COLORS recommendation: `recommend`, `human_review`, or `decline`.
- `decline` is an internal recommendation only. It must not be shown to the applicant as a rejection.
- Applicants never see `recommend`, `human_review`, `decline`, `passed`, `redirected`, `rejected`, scores, confidence, or reviewer notes.
- Every completed application should receive human review. Groucho never makes the final community decision.
- The final decision always belongs to COLORS/the client.
- Every applicant should produce a reviewer-facing report or bio with a confidence score.
- Groucho may finish early once it has enough evidence to make a private recommendation.
- Groucho must ask no more than nine applicant-facing questions total, including the opening question and follow-ups.
- Groucho may ask no more than two follow-ups for any one core question.
- The nine-question total cap overrides the per-question follow-up allowance.
- After two unsuccessful follow-ups on the same signal, Groucho records `insufficient_evidence` for that signal and moves on or concludes.
- Name and location are not needed for the decision and should not be treated as scored evidence.
- The applicant-facing close must be neutral and must not imply acceptance.
- The close may mention an accurate, non-evaluative detail from the applicant's answers.

Until the platform exposes project-specific terminal enums, the COLORS product recommendation maps onto Groucho's current terminal statuses:

| COLORS recommendation | Groucho terminal | Meaning |
| --- | --- | --- |
| `recommend` | `passed` | Evidence supports approval, but the client still makes the final decision. |
| `human_review` | `redirected` | Evidence is incomplete, contradictory, borderline, or uncertain. |
| `decline` | `rejected` | Evidence suggests poor fit, but the client still makes the final decision. |

## Remaining Client Questions

1. What is the minimum evidence for a `recommend`?
   Example decision needed: is one strong answer enough, or does COLORS need strong evidence across maker/multiplier intent, community care, and contribution?

2. What makes someone a convincing maker?
   Ask COLORS for concrete accepted examples across roles such as artist, producer, DJ, writer, curator, organizer, filmmaker, label worker, event host, photographer, designer, or technically skilled collaborator.

3. What makes someone a convincing multiplier?
   Ask for examples of non-maker applicants who should still be recommended because they create useful attention, feedback, context, introductions, discussion, care, or momentum.

4. What should count as neutral profile data rather than scored evidence?
   Current candidates: name, location, polished writing, follower count, fame, professional status, known artist references, fluent English, and the single-select participation style.

5. What evidence should trigger `decline` rather than `human_review`?
   COLORS should define the line between "not enough signal yet" and "active evidence of poor fit."

6. What evidence should always force `human_review`?
   Current candidates: contradiction, very short answers after follow-up, unclear intent, possible safety issue, possible exclusionary language, or ambiguous AI/artist-authorship views.

7. How should Groucho evaluate short but sincere answers?
   The rubric needs examples where a brief answer is acceptable, and examples where brevity is `insufficient_evidence`.

8. How should Groucho treat applicants who are mainly listeners?
   COLORS should decide whether "I mostly listen" can still lead to `recommend` when other answers show care and useful participation.

9. What are hard safety boundaries?
   The brief names dignity, queer and trans belonging, artist consent, burnout, and dehumanising language. COLORS should confirm which cases end the application early and which go to review.

10. What should the human reviewer see?
   Current direction: the reviewer packet should include an applicant bio/report, advisory recommendation, confidence score, per-signal evidence, missing signals, safety flags, and a short explanation. The exact layout and field names still need product design.

## Reviewer Packet Direction

Groucho should act like an analyst preparing the file for a human reviewer, not like an automated admissions system.

Each completed application should produce:

- Applicant bio: a short, neutral summary of who the person appears to be from their answers.
- Advisory recommendation: `recommend`, `human_review`, or `decline`.
- Confidence score: how confident Groucho is in its advisory recommendation, based only on evidence quality.
- Evidence summary: the strongest concrete details from the application.
- Missing or weak signals: any important rubric areas left vague or unresolved.
- Safety or integrity flags: contradictions, repeated avoidance, refusal, abusive language, or other review concerns.
- Suggested reviewer focus: what the human should pay attention to when making the final decision.

This report should help COLORS review consistently. It must not grant access, reject an applicant, send invitations, or determine final status by itself.

## Examples Needed From COLORS

Ask the client for examples in these groups. Real past applications are ideal, but invented examples are enough if they reflect COLORS' actual judgment.

| Example set | Needed examples | Why it matters |
| --- | --- | --- |
| Clear `recommend` | 5 short sample applications | Defines the minimum evidence threshold for approval. |
| Clear `decline` | 5 short sample applications | Shows what poor fit looks like without relying on taste, status, or fluency bias. |
| `human_review` | 5 borderline or uncertain applications | Teaches the model when uncertainty should not become a private decline. |
| Early finish | 3 applications where Groucho can stop before all core questions | Defines "enough evidence" in practice. |
| Follow-up recovery | 3 vague first answers that become usable after one or two follow-ups | Clarifies when to keep probing. |
| Insufficient evidence | 3 answers that remain too vague after two follow-ups | Clarifies when to record `insufficient_evidence`. |
| Bias guardrails | Examples with unknown artists, imperfect English, low status, or short answers that should not be penalized | Prevents the rubric from rewarding polish or proximity. |
| Safety boundary | Examples of answers that require a calm boundary or human review | Makes dignity and belonging rules operational. |

## Draft Rubric Shape

The final rubric should be a small structured table, not a long essay. Each signal should have:

- Signal name.
- What strong evidence looks like.
- What acceptable evidence looks like.
- What concerning evidence looks like.
- What counts as `insufficient_evidence`.
- Whether the signal is required for `recommend`.
- Whether the signal can independently force `human_review` or `decline`.
- Example answers for each evidence level.

Proposed signal areas:

- Intent: why the applicant wants to join beyond access, exposure, or discovery.
- Maker/multiplier evidence: how they participate in culture, creative work, attention, feedback, or community.
- Attention and taste: whether they can explain why something matters without status-chasing.
- Community care: how they respond to unfinished work, difference, vulnerability, dignity, and belonging.
- Contribution: what they would realistically add in the first month.
- Safety and integrity: whether any answer undermines artist consent, dignity, or community trust.

## Product Decisions Still Open

- Whether `recommend` requires both maker/multiplier evidence and community-care evidence.
- Whether the participation-style single select is scored or descriptive only.
- Whether a clear safety boundary should produce immediate `decline` or always route to `human_review`.
- The exact reviewer report layout and field names.
- Applicant data retention, access, and deletion policy after legal/GDPR review.
- Whether COLORS wants project-specific enums in the platform, or whether the current `passed` / `redirected` / `rejected` mapping is acceptable behind the scenes.
