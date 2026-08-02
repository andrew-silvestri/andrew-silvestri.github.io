# andrewsilvestri.com

The published site: energy systems models, a calibrated model of the world
energy system, and an interactive atlas.

Plain static files. No build step, no dependencies, no framework. Every page
works offline if you open it directly.

Generated from `00 PUBLISH` in the working repository. Do not edit files here by
hand: run `publish.ps1` from that folder, which rebuilds this repository from
`00 PUBLISH/site`.

| Path | What it is |
|---|---|
| `index.html` | Front page. The globe is the 7,192-node model at real coordinates. |
| `atlas-app.html` | The atlas: six layers on a globe, behaviour in a brain. |
| `longevity-app.html` | Longevity quotient visualiser, 417 species. |
| `assets/` | Figures, and the data the interactive pages carry. |
| `downloads/` | Source archives for every model on the site. |
| `CNAME` | Keeps the custom domain attached across pushes. Do not remove. |
