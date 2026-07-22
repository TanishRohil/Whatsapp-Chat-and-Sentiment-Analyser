# Threadline — WhatsApp Chat Analytics

A full redesign of the original Flask-based WhatsApp analyzer, rebuilt as a
**static, client-side web app**. There is no backend, no Python, and no
server-side processing — the chat file is parsed and analyzed entirely in
the visitor's browser with JavaScript, then discarded when they close the tab.

## Why it was rebuilt this way

The original app was a Flask server that depended on nltk (with runtime
data downloads), kaleido (a headless-Chrome PDF/image renderer), and
wordcloud/PIL with a local mask image — all fragile to install and keep
working on a hosting platform, and all requiring the user's private chat
log to be uploaded to a server. Moving the analysis into the browser:

- removes every one of those dependencies,
- makes deployment trivial (any static host works, see below),
- and means a person's chat data never leaves their device.

## What's included

- `index.html` — page structure (upload screen + dashboard)
- `styles.css` — the visual design
- `app.js` — WhatsApp `.txt` export parser + all analytics + chart rendering
- `assets/afinn-lexicon.js` — bundled AFINN-165 sentiment word list (CC BY-SA
  4.0, Finn Årup Nielsen), used for the sentiment analysis instead of
  server-side NLTK/VADER
- Chart.js is loaded from a CDN (`cdnjs.cloudflare.com`) at runtime

## Features

- Drag-and-drop (or browse) upload of a WhatsApp `.txt` export
- Overview stats: total messages, participants, media, emoji
- Messages per person, activity by hour/day/month
- Media-per-person and top-emoji breakdowns
- A lightweight word cloud of the most-used words (stopwords removed)
- Sentiment analysis (positive/neutral/negative) with the standout messages
  in each category
- A date-range tool to re-run sentiment analysis on just a slice of the
  conversation

## Running it locally

No build step or install is required. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

or just double-click `index.html` (drag-and-drop upload works either way;
if your browser blocks `file://` fetches for anything, note the app doesn't
fetch any files itself — the lexicon is inlined as a `<script>`).

## Deploying it

Because this is a static site (no server code to run), you can deploy it
to any static host in a couple of minutes:

**Netlify (drag-and-drop, easiest)**
1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page
3. Done — you get a live URL immediately

**Vercel**
```bash
npm i -g vercel
cd wa-analytics-site
vercel --prod
```

**GitHub Pages**
1. Push this folder's contents to a GitHub repo
2. Repo → Settings → Pages → set source to the branch/`root`
3. Your site is live at `https://<username>.github.io/<repo>`

**Cloudflare Pages**
1. Create a new Pages project, connect the repo (or direct upload)
2. Build command: none · Output directory: `/`

## Notes on the analysis

- Group name is detected from "created group" / "changed the subject"
  system messages; for two-person chats it falls back to "A & B".
- Dates are parsed assuming either `DD/MM/YY` or `MM/DD/YY` — the parser
  guesses based on which number is over 12.
- Sentiment scoring uses the AFINN-165 word list rather than a full ML
  model, so treat it as a rough signal, not ground truth.
