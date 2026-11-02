# Consultant performance review

Run it whenever you need it. You choose the consultants and the months. It checks **every contact
assigned to them** in that period and **every deal they created** against the contact and deal
compliance rules. It also checks how fast leads were worked, whether lead stages moved correctly,
and whether qualified clients were marked qualified.

You get one email with a summary for each consultant and an Excel workbook attached. The workbook has:

- **Summary**: every consultant side by side, with team totals.
- **Scorecard**: every check for every consultant, as a pass % and "fails of checked".
- **Contacts** and **Deals**: every record, with Pass / Fail for each rule and what is wrong.
- **Issues**: every problem found, one row each, so you can filter by consultant or check.
- **Never worked**: leads that were assigned but never contacted.
- **Qualification**: clients who got a deal but were not marked qualified, leads marked qualified
  with no deal, and won deals not marked Sale.
- **A tab per consultant**, which you can share with that person.
- **How it was checked**: every rule, written out.

It is read-only: nothing in HubSpot is changed.

---

## Setting it up (once)

1. Create a new **private** repo, for example `hof-consultant-performance`.
2. Upload these files to the root of the repo:
   - `config.js`, `0-hubspot.js`, `1-clock.js`, `2-collect.js`, `3-rules.js`, `4-contacts.js`
   - `5-deals.js`, `6-notes-ai.js`, `7-score.js`, `8-workbook.js`, `9-email.js`
   - `report.js`, `selftest.js`, `package.json`
3. Click **Add file → Create new file** and name it `.github/workflows/consultant-performance.yml`
   (typing the slashes creates the folders). Paste in the contents of `consultant-performance.yml`.
4. Go to **Settings → Secrets and variables → Actions** and add the same secrets your other agents use:

| Secret | |
|---|---|
| `HUBSPOT_TOKEN` | the HOF private app token |
| `RESEND_KEY` | the key your other reports send with |
| `GEMINI_KEY` | optional: reads call notes for missed qualifications (see below) |

## Running it

Go to **Actions → Consultant performance review → Run workflow**. The boxes are already set for this review:

- **consultants**: `Muhammad Shahzad, Muhammad Diean, Fatima Zahid, Ayesha Zahid`. Type any names or
  HubSpot owner ids, separated by commas. If a name matches more than one person, the run stops and
  lists the matches.
- **period**: *Previous 3 months* (run in November, that means 1 August to 31 October).
  *Custom dates* uses the two date boxes, for example `2026-09-01` and `2026-09-30`.

Then press **Run**. It takes about 10 to 20 minutes, because every contact's stage history is read
one by one. The email goes to razaali@hofmigration.com. The workbook is also kept for 7 days on the
run's page, under **Artifacts**. It contains client names, so keep the repo private.

---

## What is checked

The checks were built and tested on real records from the portal.

**Handling**
- The lead was worked: a call, email or WhatsApp was logged after it was assigned. A note on its own does not count.
- The first contact came within 24 working hours of assignment.

**Lead stage**
- A lead stage is marked.
- An Outcome is marked once calls have been made.
- No Answer, Switched off, Cannot Dial, Call Back and Wrong Number are backed by logged calls.
- A lead is not left on No Answer after a connected call.
- A lead is closed (Ineligible, They Didn't Fill…) or qualified only after the client was contacted.
  This is not counted if the stage was already set before assignment, or if a workflow set it.
- Ineligible and They Didn't Fill have a reason. An Outcome such as "No Education" counts as the reason.

**Calls, while it is a lead**
- A call was logged, not only an email or WhatsApp.
- Every call has an outcome.
- Connected calls have a description.

**Follow-up**
- A WhatsApp was sent within 24 working hours of every day of unanswered calls.
- An email was sent once calls were made.
- Emails greet the client by name and have no placeholders left in.
- A live lead (No Answer, Switched off, Call Back, or qualified with no deal yet) has an open follow-up task.

**Qualification**
- A client who got a deal is marked qualified.
- A lead marked qualified gets a deal within 2 working days.
- A won deal's lead is marked Sale.

**Deals** (the deal compliance rules, plus stage moves)
- Close date not in the past.
- Postponed and Lost deals have a real reason, not "Opportunity".
- Last Month Rollover is only used after the month the deal was created.
- No open deal sits for 30 days with nothing logged and no stage change.
- The deal is in the pipeline that matches the lead stage (USA NIW → USA NIW pipeline, and so on).
- An open follow-up task, not overdue.
- Calls logged on the deal, and connected calls have a description.
- Process details emailed after the first connected call.
- Email and WhatsApp within 24 working hours of every day of unanswered calls.
- A client details note on the deal.
- Proof of payment on won deals.
- The contact's Outcome keeps "Deal Created" ticked, and age range and nationality are marked.

**Compliance %** = checks passed ÷ checks that applied. If a check doesn't apply to a record (a lead
with no calls has no "call outcome" check), it counts neither way. The target is 85%.

## Things to know

- **"24 hours" means 24 working hours.** Saturday, Sunday and UAE public holidays are not counted,
  so Friday 3pm is due Monday 3pm. Add the 2027 holidays to `config.js` once they're announced;
  the report warns if a year has none.
- **The dialler logs a copy of each call.** It adds its own "Call id: …" entry about a minute
  from the consultant's log. Calls by the same person within 10 minutes count as one attempt, and
  a "Call id" line is not a description.
- **Once a deal exists, follow-up is checked on the deal**, not the contact, so the same call is
  never counted twice.
- **A deal counts for the consultant who created it.** It still counts for them after it is won and
  handed to a case manager. Deals someone else created for them count for the owner.
- **HubSpot's "assigned date" can move.** It updates when the owner is set again, even to the same
  person. The review reads the owner history and counts from when the consultant really started on
  the lead. Those rows are marked in the workbook.
- **Screenshots count.** A screenshot pasted into a note on a won deal counts as proof of payment.
  One pasted that day also counts as the WhatsApp follow-up. To turn either off, change
  `IMAGE_NOTE_IS_PAYMENT_PROOF` or `IMAGE_NOTE_IS_WHATSAPP` in `config.js`.
- **Contacts moved to someone else can't be seen.** Only contacts still owned by these consultants
  are included. Calls, emails or WhatsApps made outside HubSpot count as not done.
- **Call notes (optional).** With the `GEMINI_KEY` secret, the call notes of leads *not* marked
  qualified are read for clear signs the client did qualify. They are listed in the Qualification
  tab **for review only and never scored**. Without the key, this step is skipped and the report
  says so.
- If no WhatsApp at all can be read from HubSpot, the WhatsApp checks are left out rather than
  counted as missed, and the email says so.
- The built-in Resend sender only reaches your own address. To send to your manager directly,
  verify `hofmigration.com` in Resend first, then set `FROM_EMAIL` and `CC` in `config.js`.

## Changing a rule

Everything is in `config.js`. Every rule has a test in `selftest.js`, which runs before each review
and shows `115 passed, 0 failed`. If a rule breaks, the review doesn't go out.
