# Roadmap

The public version keeps getting better. Nothing here is scheduled; these are directions, roughly in order.

## Guardrails that survive every version

Whatever gets added, these hold:

- **Answers stay private by default.** Any feature that sends answers anywhere (AI-assisted intake included) is opt-in, explained plainly at the moment of choice, and never required to finish a portrait.
- **No scores, types, rankings, or verdicts.** Everything the app reflects back is a caricature to argue with.
- **The person owns their output.** Download always works; nothing is held back behind an account or a paywall.

## 1. Newsletter signup (interim, before any donation ask)

A simple email signup at the bottom of the portrait flow for people who want updates when the app improves. The plumbing partly exists already: the old band site had a working `/api/mailing-list` endpoint that synced signups to a Google Sheet (see git history around April 2026 and `archive/band/js/main.js`). Resurrect that route in `server.js`, point it at a fresh sheet or a proper ESP list, and add the form to the final screen.

Signup email is the ONE thing that leaves the browser, clearly labeled as such, and stored separately from anything portrait-related. Answers still never leave the page.

## 2. AI-assisted intake

Use a small, cheap model (Claude Haiku, or Sonnet if the quality gap matters) to make the quiz feel like a conversation instead of a form:

- Follow-up probes when an answer is thin ("you said 'talking to customers': what were you actually doing the last time that lit you up?")
- Reflecting an answer back before moving on, the way the full facilitator does
- Drafting the chart-reading one-liners from the person's own words instead of templates

Design constraints: answers currently never leave the browser, so this needs a thin server-side proxy for the model API (never expose a key client-side), a clear opt-in ("want an AI to interview you? your answers will be sent to Anthropic to generate responses, or stick with the classic form"), and a hard per-session token cap so cost stays pocket change. The classic no-AI form remains the default path.

## 3. Donation button

Once the newsletter loop is running and the app has a public following: a small "keep this free" donation link at the bottom (Stripe Payment Link or Ko-fi, no accounts, no paywall). The app stays fully functional without paying, always.

## Later / maybe

- Vibe picker for the star chart output (the internal version lets people pick their own visual reference; the public one could offer 3-4 themes)
- A "revisit in 6 months" reminder via the newsletter list, since portraits are snapshots and seasons change
