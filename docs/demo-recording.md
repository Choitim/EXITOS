# Recording the demo

A short script for producing the README GIF/video and the launch clip. Everything shown is the
built-in synthetic workspace — never record a real workspace.

## Reproducible, no tools needed

`pnpm docs:assets` regenerates `docs/assets/demo.svg` from the **actual output** of `exitos demo`, so
the README image can never drift from the product. `pnpm docs:screenshots` regenerates the dashboard
PNGs (needs `pnpm exec playwright install chromium`).

## Terminal recording with VHS

[VHS](https://github.com/charmbracelet/vhs) renders a GIF/MP4 from a script. Install it separately
(it is not a dependency of this repo), then:

```bash
pnpm build
vhs docs/demo.tape          # writes docs/assets/demo.gif
```

[`docs/demo.tape`](demo.tape) pauses on the three moments that matter: the **moves / changes / cannot
move** summary, the injected failures being recovered from, and the final **verified + not preserved**
report.

## Terminal recording with asciinema

```bash
asciinema rec -c "pnpm exitos demo --pace 700" demo.cast
```

`--pace <ms>` pauses between steps so viewers can read. Use a 100×30 terminal, a dark theme and a font
of at least 18 px.

## 30-second cut

Follow the storyboard in [launch-plan.md](launch-plan.md#30-second-demo-video--storyboard). Tips:

- Run `pnpm exitos demo --pace 900` for the long takes, then speed up the apply step in the editor.
- Show `pnpm exitos ui --demo` for 3 seconds at the end.
- Keep the OFFLINE DEMO banner visible in the first frame — it is part of the honesty of the video.
- Do not add claims the tool does not make (no "zero data loss", no "works with any app").
