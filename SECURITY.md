# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately through GitHub:
[Security ▸ Report a vulnerability](https://github.com/willard/woodshop-desktop/security/advisories/new).

Include what you found, how to reproduce it (a `.woodshop` file or a spec is ideal), and which
version and operating system you used. You should get a reply within a week. Once a fix is
released, the advisory is published with credit to you unless you prefer otherwise.

## Supported versions

Only the latest release gets security fixes. The in-app updater (Settings ▸ Updates) installs it.

## What counts

Woodshop opens files from other people (`.woodshop` archives, spec JSON) and runs a local MCP
server for AI agents, so these are especially interesting:

- a crafted `.woodshop` file or spec that crashes the app, writes outside the library, or runs
  code;
- anything that lets the webview or an MCP client read or write files beyond what the app's
  commands allow;
- a way to make the updater install something not signed with the project's key.

Bugs that need an attacker who already controls your user account are out of scope.
