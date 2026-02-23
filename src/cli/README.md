# The CLI

It's actually super straight-forward

```sh
ei                             # Start the TUI
ei "query string"              # Return up to 10 "query string" across all types
ei -n 5 "query string"         # Return up to 5 results
ei facts -n 5 "query string"   # Return up to 5 facts
ei traits -n 5 "query string"  # Return up to 5 traits
ei people -n 5 "query string"  # Return up to 5 people
ei topics -n 5 "query string"  # Return up to 5 topics
ei quotes -n 5 "query string"  # Return up to 5 quotes
```

# An Agentic Tool

To register Ei as an explicit OpenCode tool (optional — agents can also just call `ei` via shell):

```bash
mkdir -p ~/.config/opencode/tools
```

Create `~/.config/opencode/tools/ei.ts`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Search the user's Ei knowledge base for facts, people, topics, traits, and quotes",
  args: {
    query: tool.schema.string().describe("Search query"),
  },
  async execute(args) {
    return await Bun.$`ei ${args.query}`.text()
  },
})
```
