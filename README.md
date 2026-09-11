# andrewsilvestri.com

The published site: energy-system models, a life-cycle emissions calculator,
and research pages on animal lifespan, research effort, city skylines and
plate motion.

Plain static files. No build step, no dependencies, no framework. Every page
works offline if you open it directly.

Generated from `00 PUBLISH` in the working repository. Do not edit files here by
hand: run `publish.ps1` from that folder, which rebuilds this repository from
`00 PUBLISH/site`.

| Path | What it is |
|---|---|
| `index.html` | Front page: a live canvas integrating a named nonlinear system from its published equations, and an index of the projects. |
| `*-app.html` | A full-screen viewer, opened in a new tab from the page it belongs to. |
| `assets/` | Figures, and the data the interactive pages carry. |
| `downloads/` | Source archives for every model on the site. |
| `CNAME` | Keeps the custom domain attached across pushes. Do not remove. |
