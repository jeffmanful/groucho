# Pilot demo: the Tidewater drop

**Recorded:** 27 October 2026. **Status:** demo story agreed; prerequisites below not yet built.
**Everything here is fictional.** Halden Works, Mara Quinn, Pierside Hall, the Tidewater shoe,
every applicant and every moment are invented for demonstration. They are not modelled on a
real client. Label the demo as fictional wherever it is shown.

## Why this demo

It combines the drop operator loop and the fan presale into one story, and every screen is the
real product working on staged inputs: the client, the brief and the applicants are made up;
what Groucho does with them is not. Nothing is simulated in the browser.

The story in one line: **lots of people want a limited release; Groucho helps the brand clear
out duplicates, see who its real supporters are, give some of them a guaranteed place and run a
fair ballot for everyone else, then hands the result to the brand's own systems.**

## The client

**Halden Works** is an independent footwear label from Deptford, south-east London, founded in
2023 in a railway arch. About 9,000 people are on its mailing list. It sells through its own
Shopify store and emails its customers itself.

**Mara Quinn** is a London singer-songwriter with a loyal following since her debut EP, *Low
Water*. She has worn Halden boots on stage since her first headline show.

**The release:** the *Halden Works × Mara Quinn "Tidewater"* runner. 240 pairs, UK sizes 5 to 11,
£140. Mara plays a launch show at **Pierside Hall**, Deptford (300 capacity), on release night.

## The brief (as the client would send it)

> We're releasing 240 pairs of the Tidewater. Last time we did a first-come-first-served drop,
> the site fell over, the same few people bought multiple pairs, and loyal customers who'd been
> with us since the arch missed out.
>
> This time:
>
> - Entries open for 48 hours. Arriving early doesn't help.
> - One entry per person. We'll pick a size when we enter.
> - 40 pairs are held back for genuine supporters of Halden and Mara. We'd like to choose those
>   ourselves, but we can't read a thousand entries.
> - The other 200 go to a fair ballot by size.
> - Anyone not drawn goes on a waitlist in case pairs come back.
> - We'll email winners and run checkout on our own store. We just need the list and a record of
>   how it was decided.
> - Entering takes a minute. Telling us your story is optional and won't affect the ballot.
>
> Success for us: no one wins twice, our team spends an afternoon on this rather than a week, and
> the people who've been with us feel seen.

## How Groucho answers the brief

| The brief says | Groucho does (real today unless marked) |
|---|---|
| Entries open 48 hours | The round's entry window; entries outside it are refused |
| One entry per person | Entries sharing an email, phone number or social account are flagged; disposable email providers too. The team resolves each group |
| Pick a size | A drop field on each entry, used for filters and the draw |
| Telling your story is optional | A short conversation with the Halden persona. Groucho reports what each person said that shows real support, with quotes |
| 40 held back for supporters | A *Guaranteed* cohort the team fills by hand, reading the evidence. Groucho's reading informs; people decide |
| 200 by ballot per size | A *Ballot pool* cohort, locked, then a one-time draw per size with secure randomness |
| Waitlist | Everyone not drawn moves to *Waitlist* in draw order, per size |
| We email and run checkout | Groucho sends `application.allocated` for each person and exports CSVs. It never contacts applicants |
| A record of how it was decided | Every decision, move, lock and draw is recorded with who did it and the rule used |

## Stock and demand (seeded)

| UK size | Ballot pairs | Entries |
|---|---:|---:|
| 5 | 15 | 70 |
| 6 | 25 | 140 |
| 7 | 35 | 210 |
| 8 | 40 | 260 |
| 9 | 40 | 250 |
| 10 | 30 | 170 |
| 11 | 15 | 84 |
| **Total** | **200** | **1,184** |

Plus 40 guaranteed pairs, held across sizes. About 180 entrants also tell their story.

## The brand's moments (persona context)

The Halden persona asks one or two memory questions drawn from these. Today this is persona
context written into the prompt; the rotating question bank is specified in
[fan-evidence-and-question-bank.md](../docs/fan-evidence-and-question-bank.md) and not yet built.

- **The arch** (2023): Halden started in a Deptford railway arch; the first boot was numbered
  *001* and the founder hand-stamped the boxes.
- **The van drop** (2024): the first sample run sold from the back of a van in a Peckham car park
  on a rainy Saturday; the stamp ink ran on the boxes.
- **Pierside Hall** (March 2025): Mara's first headline show. Her keyboard broke halfway through
  and she played an unreleased song, *Saltmarsh*, on acoustic guitar instead.
- **The repair day** (2025): Halden fixes old boots free once a year, in the arch.

## The cast (designed cases among the seeded entries)

| Who | Case | What the demo shows |
|---|---|---|
| **Theo Marsh, T. Marsh, Teddy M** | Same phone number, sizes 8, 9 and 10, within a minute | Keep one, decline two as duplicates, with a reason |
| **Priya Anand and Dev Anand** | Same phone, different people (a household) | *Not duplicates*: shared phones aren't proof |
| **Jules Okafor and J. Okafor** | Same Instagram account on two entries | Keep the earlier entry |
| **Kai R.** | Disposable email provider | Decline, or mark the provider as fine |
| **Ruth Adeyemi** | Told her story: was at the van drop and remembers the ink running on the boxes in the rain | Specific, lived detail. The team places her in *Guaranteed* |
| **Sol Brennan** | Told his story: at Pierside Hall when Mara played *Saltmarsh* on guitar after the keyboard broke | Same. Placed in *Guaranteed* |
| **Max Ellery** | Long, fluent, enthusiastic, but nothing specific | Polish isn't depth. Stays in the ballot |
| **Ana Lima** | Short answers; found Halden last month through a friend | Newer fans aren't penalised. Stays in the ballot with an equal chance |
| **Jordan Kim** | Private Instagram, no story | Perfectly eligible. Missing evidence never counts against anyone |

Seed data uses `example.com` and `.test` email addresses and phone numbers from Ofcom's range
reserved for drama (07700 900000 to 07700 900999).

## Run of show (about 20 minutes)

1. **The brief** (1 min). Show the brief above as the client's own words.
2. **Entering** (2 min). The client's entry page: name, email, size, optional socials, then
   *"Tell us your Halden story (optional)"*. The presenter enters live and has the short
   conversation.
3. **Clearing the noise** (4 min). Entries page: 1,184 entered, flagged count highlighted.
   - Flagged tab: the Marsh group, keep one and decline two with a reason.
   - The Anand household: *Not duplicates*.
   - Kai's disposable email: decline.
   - Back to To review: *No flags*, select all matching, approve.
4. **Seeing supporters** (4 min). Approved entries who told a story.
   - Open Ruth and Sol: the evidence quotes and why Groucho read them as specific.
   - Contrast Max (fluent, generic) and Ana (quiet, new).
   - Add Ruth, Sol and others to *Guaranteed* with Choose. The team decides; Groucho informs.
5. **The ballot** (4 min). Cohorts page.
   - Fill *Ballot pool* with everyone unallocated, then lock it.
   - Draw by size: per-size winners against the stock table, everyone else to *Waitlist* in draw
     order. Point out it can't be run again.
   - The history: who placed whom, the lock, the draw and its rule.
6. **The hand-off** (3 min). Export winners as CSV. In the client app, the webhook log shows
   `application.allocated` for each person with whether they have access. Halden emails them and
   runs checkout on its own store.
7. **What was recorded** (2 min). One person's record from entry to decision to cohort, and the
   audit trail of the draw.

## Prerequisites

| # | What | Why | Size |
|---|---|---|---|
| 1 | **One person, one record**: a conversation can attach to an existing entry (or start with the entry's fields), instead of being a separate session | Today the form entry and the conversation are separate records, so the same email is flagged as a duplicate of itself and the story isn't on the entry | Small to medium (build) |
| 2 | **Seed script**: creates the demo organisation, the Halden persona, the project with the entry window, entries through the real API, pre-run conversations, and the empty cohorts (*Guaranteed*, *Ballot pool*, *Waitlist*) | Every run starts from the same believable state; rerun to reset | Medium (build) |
| 3 | **Fan evidence on Entries and in the picker**: Groucho's summary and quotes beside each person | Step 4 otherwise means opening dozens of applications | Small (build; phase 1 of the fan evidence spec) |
| 4 | **Client app**: Halden entry page with the optional chat, using the SDK relay, plus a page that shows incoming webhooks | Shows the boundary: Groucho decides, Halden communicates | Small to medium (build on `examples/next-groucho`) |
| 5 | **Halden persona**: warm, brief, one or two memory questions, tuned and replay-tested | The conversation must feel like the brand, not an interview | Medium (persona work) |
| 6 | **Pre-run conversations**: about 180, generated by running the real persona against scripted applicants (including the cast) | Real transcripts produced by the real system, not written by hand | Small once 2 and 5 exist |

Run it in a separate demo organisation marked as test, so none of its numbers reach real
reporting.

## What not to claim

- Groucho doesn't run checkout, hold stock or send emails. Halden does.
- Duplicate flags are matches on email, phone and social accounts, not bot detection.
- Groucho's reading of a story is evidence for people to weigh, not a score that places anyone.
- The rotating question bank, fan evidence from lists or connected accounts, and purchase windows
  that expire are not built. The old drop sandbox shows purchase windows as a concept only.

## Variant: Mara Quinn at Pierside Hall

For promoter and artist conversations, the same story works as a ticket presale: 300 tickets, one
ticket type, so no size. 60 held for supporters, 240 by ballot, the rest to a waitlist. The
ticketing partner issues tickets from Groucho's winners list. Same cast; swap the shoe for the show.
