// config.js — Consultant performance review. SAFE TO EDIT.
//
// Every rule is written out here in plain words, and repeated in the "How it was checked"
// tab of every report. If a rule is wrong, change it here, never quietly in the code.
// Who and which period are chosen when you press Run workflow, not here.

const SETTINGS = {
  // ---- who and when (the Run workflow boxes fill these in) ----
  DEFAULT_CONSULTANTS: "Muhammad Shahzad, Muhammad Diean, Fatima Zahid, Ayesha Zahid",
  DEFAULT_PERIOD: "Previous 3 months",   // Previous month | Previous 2 months | Previous 3 months | Custom dates

  // If HubSpot's user list cannot be read, these names still resolve.
  KNOWN_CONSULTANTS: {
    "84648486": "Muhammad Shahzad Fiaz",
    "83210660": "Muhammad Diean",
    "84172062": "Fatima Zahid",
    "84172061": "Ayesha Zahid",
  },

  // ---- the clock ----
  // "24 hours" means 24 working hours: Saturday, Sunday and UAE public holidays are not
  // counted, the same rule as the WhatsApp and email-reply reviews. Friday 3pm is due
  // Monday 3pm. Set FLAT_24_HOURS to true for a plain 24 hours.
  TZ_OFFSET_HOURS: 5,                  // Pakistan time
  WEEKEND_DAYS: [6, 0],                // Saturday and Sunday
  FLAT_24_HOURS: false,
  HOLIDAYS: [                          // UAE private-sector public holidays, as announced
    "2026-01-01",
    "2026-03-19", "2026-03-20", "2026-03-21",
    "2026-05-26",
    "2026-05-27", "2026-05-28", "2026-05-29",
    "2026-06-15",
    "2026-08-28",
    "2026-12-02", "2026-12-03",
  ],
  FIRST_CONTACT_HOURS: 24,             // a new lead is called, emailed or WhatsApped within this
  FOLLOW_UP_HOURS: 24,                 // WhatsApp / email after an unanswered call within this
  LATE_LIMIT_HOURS: 72,                // a message later than this (working hours) counts as missing, not late

  // ---- lead stages (HubSpot's internal values: "Qualified" shows as "Qualified CAN",
  //      "Call Back" shows as "Schedule Call Back") ----
  QUALIFIED_STAGES: ["USA NIW", "Qualified", "Qualified AUS", "Qualified Spain",
    "Germany Opportunity Card", "Visit Visa", "Work Permit", "Portugal D2/D8"],
  SALE_STAGE: "Sale",
  NOT_REACHED_STAGES: ["No Answer", "Switched off", "Cannot Dial"],
  CALL_BACK_STAGE: "Call Back",
  CLOSED_STAGES: ["They Didn't Fill", "Wrong Number", "Ineligible", "Occupation Not Listed",
    "Outside GCC", "Already Migrated", "Duplicate", "Started With Competitor"],
  // Stages that can honestly be set without speaking to the client.
  NO_CONTACT_NEEDED_STAGES: ["Duplicate", "Outside GCC"],
  // Stages that must carry a reason, and the fields that hold it.
  REASON_FIELDS: {
    "Ineligible": ["reason_for_didnt_fill", "hof_ineligible_reason"],
    "They Didn't Fill": ["reason_for_didnt_fill"],
  },
  // Consultants also record why a lead is ineligible in its Outcome; these count as the reason.
  REASON_OUTCOMES: ["No Education", "No Work Experience", "Age", "Occupation Not In Demand (Specify Occupation)", "Lead Outside Gulf"],
  // Live lead stages that need an open follow-up task (Cannot Dial is a dead number, as in
  // the contact rules, so it does not).
  TASK_STAGES: ["No Answer", "Switched off", "Call Back"],
  // A deal for a client in these lead stages belongs in these pipelines (sales, or the
  // matching service pipeline once won).
  STAGE_PIPELINES: {
    "USA NIW": ["642383975", "149481597"],
    "Qualified": ["26699617", "26920574"],
    "Qualified AUS": ["26699617", "26920574"],
    "Visit Visa": ["97449039", "62098241"],
    "Work Permit": ["647754380", "647720619", "107223591"],
    "Germany Opportunity Card": ["818310187", "818967055"],
    "Qualified Spain": ["818882472", "818967057"],
  },
  // A qualified lead gets a deal within this many working days of being marked qualified.
  DEAL_CREATED_GRACE_DAYS: 2,

  // ---- pipelines ----
  SALES_PIPELINES: {
    "26699617": "HOF Sales Pipeline - Canada & AUS",
    "642383975": "USA NIW Sales Pipeline",
    "97449039": "HOF Sales Pipeline (Visit)",
    "647754380": "HOF Sales - Work Permit",
    "818310187": "HOF Sales - Germany Opportunity Card",
    "818882472": "HOF Sales - Spain",
    "97796183": "HOF Student",
  },
  // Won deals are moved here and handed to a case manager.
  SERVICE_PIPELINES: {
    "26920574": "HOF Service Pipeline - Canada & AUS",
    "149481597": "HOF Service Pipeline (USA NIW)",
    "62098241": "HOF Service Pipeline Visit",
    "818967055": "HOF Service Pipeline - Germany Opportunity Card",
    "818967057": "HOF Service Pipeline - Spain",
  },
  // Anything else (Finland, Norway, Referral) is listed but not checked.

  // ---- deal rules (the deal compliance rules) ----
  CLOSEDATE_GRACE_DAYS: 2,             // a close date this many days in the past is still accepted
  REASON_FORBIDDEN: ["Opportunity"],   // not a reason for postponing or losing a deal
  TASK_OVERDUE_GRACE_DAYS: 2,
  STUCK_DAYS: 30,                      // an open deal with no activity and no stage move for this long
  OUTCOME_MUST_INCLUDE: "Deal Created",// the contact's Outcome keeps "Deal Created" ticked
  DETAILS_ON_CONTACT_COUNTS: false,    // true = client details on the contact (not the deal) are accepted
  IMAGE_NOTE_IS_PAYMENT_PROOF: true,   // a screenshot pasted in a note on a won deal counts as proof
  IMAGE_NOTE_IS_WHATSAPP: true,        // a screenshot note the same day counts as the WhatsApp follow-up

  // ---- calls ----
  // Reached = the client was spoken to. The dialler logs its own copy of every call a
  // minute apart from the consultant's log, so calls this close together are one attempt.
  REACHED_OUTCOMES: ["Connected", "Meeting booked"],
  SAME_ATTEMPT_MINUTES: 10,
  TASK_PREFIX: "[Compliance]",         // our own tasks never count as the consultant's follow-up

  // ---- reading the notes (needs the GEMINI_KEY secret; left out without it) ----
  // For leads NOT marked qualified, the call notes are read for clear signs the client
  // qualified. These are listed for review, not counted in the scores.
  AI_NOTES_CHECK: true,
  GEMINI_MODEL: "gemini-flash-lite-latest",
  AI_MAX_CALLS: 500,
  AI_MAX_MINUTES: 12,
  AI_STAGES: ["No Answer", "Switched off", "Cannot Dial", "Call Back", "They Didn't Fill",
    "Ineligible", "Occupation Not Listed"],

  // ---- the report ----
  TARGET_PCT: 85,
  REPORT_TO: "razaali@hofmigration.com",
  CC: [],                              // only after hofmigration.com is verified in Resend
  FROM_EMAIL: "onboarding@resend.dev",
  SEND_EMAIL: String(process.env.SEND_EMAIL || "true").toLowerCase() !== "false",
  PER_CONSULTANT_TABS_MAX: 6,          // a tab per consultant when this many or fewer

  // ---- HubSpot ----
  PORTAL_ID: "23735726",
  SEARCH_RPS: 4,                       // HubSpot allows 5 searches a second for the whole account
  API_RPS: 8,
  OUT_DIR: "out",
};

module.exports = { SETTINGS };
