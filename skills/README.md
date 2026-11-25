# Skills for AI agents

Instructions an AI agent can load to do a Woodshop job on its own. Each folder holds a `SKILL.md`
(the format Claude Code and other agents read as a skill) and any scripts it uses.

| Skill | What the agent does |
|---|---|
| [woodshop-design](woodshop-design/SKILL.md) | Designs furniture through Woodshop's MCP server, until the design checks as buildable. |
| [woodshop-prop-model](woodshop-prop-model/SKILL.md) | Makes a GLB or STL of a real object (a tote, a tool box) to import and show with a piece. |

To use one with Claude Code, copy or link its folder into `.claude/skills/` in your project, or
into `~/.claude/skills/` for every project:

```bash
ln -s "$PWD/skills/woodshop-design" ~/.claude/skills/woodshop-design
```

Other agents can be pointed at the `SKILL.md` file directly.
