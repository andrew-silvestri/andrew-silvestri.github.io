# andrewsilvestri.com

The published site: energy-system models, a life-cycle emissions calculator,
and research pages on animal lifespan, research effort, city skylines and
plate motion.

Plain static files. No build step, no dependencies, no framework. Every page
works offline if you open it directly.

Generated from `00 PUBLISH` in the working repository. Do not edit files here by
hand: run `./publish.sh` from that folder, which rebuilds this repository from
`00 PUBLISH/site`.

| Path | What it is |
|---|---|
| `index.html` | Front page: a looped 30-second clip of a piano-studio render with a Sound button, its caption and CC BY credits (`assets/hero-video.js`), and an index of the projects. `assets/hero.js`, the live nonlinear-system canvas it replaced, is kept but not loaded. |
| `*-app.html` | A full-screen viewer, opened in a new tab from the page it belongs to. |
| `assets/` | Figures, and the data the interactive pages carry. |
| `downloads/` | Source archives for every model on the site. |
| `CNAME` | Keeps the custom domain attached across pushes. Do not remove. |
