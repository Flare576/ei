# Ei

A local-first AI companion system with persistent personas.

## Requirements

- Node.js 18+
- Local LLM provider (LM Studio, Ollama, etc.)

## LM Studio Setup

**Important**: You must enable CORS in LM Studio for browser-based EI to work.

1. Open LM Studio
2. Go to **Local Server** tab (left sidebar)
3. Enable **"Enable CORS"** toggle
4. Start/restart the server

Without this setting, browser security policies will block API calls.

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Compile TypeScript
npm run test     # Run tests
```

## Project Structure

See `AGENTS.md` for detailed architecture and contribution guidelines.
