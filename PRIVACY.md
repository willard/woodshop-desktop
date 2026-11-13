# Privacy

Woodshop works entirely on your computer. There is no account, no analytics, no crash reporting
service and no advertising.

**What stays on your computer:** your designs, versions, notes, thumbnails, settings, backups and
logs. They are in the app-data folder listed in the [README](README.md#where-your-data-lives) and
are never uploaded.

**The only times Woodshop uses the network:**

| When | What is sent | To |
| --- | --- | --- |
| You click **Check for updates** (Settings ▸ Updates) | A standard web request for the release list; GitHub sees your IP address, as with any download | GitHub Releases |
| You click **Report a problem** (Settings ▸ Diagnostics) | Opens a pre-filled issue in your browser with the app version and operating system only. Nothing is sent until you submit it yourself, and you can edit it first | GitHub Issues |
| You click a link (help, source code) | Opens in your browser | That site |

The **MCP server** (`woodshop --mcp`) talks only to the AI agent that started it, over standard
input and output on your computer. What that agent does with your designs is up to the agent and
its provider.

Files you **export** (PDF, 3D plan, CSV, SVG, `.woodshop`) contain your design and go only where
you save them. The 3D plan is a single self-contained HTML file that loads nothing from the
internet.

Any future feature that uses the network will be off until you turn it on, and will be listed
here first.
