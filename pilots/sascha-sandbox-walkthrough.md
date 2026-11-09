# Sascha's presale sandbox

Use the **Synthetic Presale** project. The sandbox contains ten fictional
submissions. It uses a sandbox-only reviewer account and a separate database.
Open the [hosted sandbox](https://groucho-presale-sandbox.vercel.app/admin/organisations/63a98017-fc78-444d-8aa2-b4489179c201/applications/entries?project=63a98017-fc78-444d-8aa2-b4489179c202)
and sign in with the reviewer credentials shared separately.

1. **Preview a CSV.** Open **Entries → Import CSV** and choose
   [the seven-signup fixture](../scripts/fixtures/presale-signups.csv). Use
   `synthetic-presale` as the source name. **Preview import** should show seven
   valid entries. **Confirm import** should report zero added and seven already
   present because the fixture is preloaded. The
   [three email examples](../scripts/fixtures/sascha-email-signups.csv) are
   also preloaded under the source name `synthetic-email`.
2. **Review email evidence.** Turn on **Email flags**. Eli and Fern share an
   email, and their temporary inbox provider is flagged. **New disposable**
   shows the flag for the newly added `concu.net` domain. Turn off the filter
   to see **Dev** and **Second Apple relay**. Both have an informational
   **Apple Hide My Email** label and remain eligible for normal review.
3. **Compare connections.** Open **Shared connection** on Alex or Dev. The
   household has three signups over nine minutes, with no email or phone
   overlap. Open it on Eli. The burst has three signups over two seconds,
   with two sharing an email and all three sharing a phone. Ask Sascha what
   else he would need to resolve each group. Leave uncertain entries pending.
4. **Export an approved cohort.** In **To review**, select two or three
   unflagged entries and approve them. Open **Approved**, select those
   entries and choose **Add to a cohort**. Create a cohort named
   **Sascha rehearsal**, or choose an empty cohort. Open **Cohorts** and
   click **Export** next to it. Check that the CSV contains the selected
   entries and their original `signed_up_at` values.

Use the sample CSVs for the rehearsal. The sandbox has no ticket fulfilment
connected. After a run, record which signals Sascha trusted, what he still
needed to see, and whether the handoff CSV fits his workflow.
See the [pilot data requirements](presale-review-sandbox.md#pilot-data-requirements)
before accepting any real signup data.
