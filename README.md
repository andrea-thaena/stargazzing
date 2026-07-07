# Stargazzing · Powers Combined

The public, self-serve version of the Powers Combined self-portrait: a ~15 minute reflection that maps where your energy lives, your superpowers, your drains, your blind spots, and what an AI sidekick should take off your plate first.

Live at **[www.stargazzing.com](https://www.stargazzing.com)**.

## What you get at the end

- A star chart you own
- A portrait file you can download (markdown)
- A ready-to-paste prompt that turns any AI assistant into your setup partner

## Private by design

Your answers never leave the page. They live only in your browser's localStorage on the device you used. There is no backend intake, no analytics on your answers, no account. If you want to keep your portrait, download the file at the end. If you clear your browser data, it's gone: that's the trade, and it's intentional.

## The philosophy, in one breath

Not a jigsaw (fixing people into their most efficient slots). An ecosystem: overlapping niches, redundancy as resilience, roles that shift with the season. Charts, astrology included, are mythology in the best sense: shapes we argue with, because humans know themselves through stories. You are the custodian of your own story, not a category or a score. Principled AI takes the drains and leaves the fire; a tool that takes work you love and returns admin is pointed backwards.

## Running locally

```bash
npm install
npm start        # serves on http://localhost:3000
```

The app is a single static page at `public/powers/index.html`, served by a small Express server (`server.js`). Deployed on Railway; pushes to `main` deploy automatically.

## History

This domain used to be a kids punk band site (Stargazing, the band). The band site is preserved in `archive/band/`. The Powers Combined app grew out of an internal team exercise at [Thaena](https://thaena.com) and was spun out here for everyone else.

See [`ROADMAP.md`](./ROADMAP.md) for where this is going.
