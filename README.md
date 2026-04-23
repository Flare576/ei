# Ei

A local-first AI companion system with persistent personas and coding tool integrations (OpenCode, Claude Code, Cursor).

You can access the Web version at [ei.flare576.com](https://ei.flare576.com).

You can run the local version via `bunx ei-tui` — no install needed, always current (see [### TUI](#tui) for details).

If you're here to give your coding tools (OpenCode, Claude Code, Cursor) persistent memory, jump over to [TUI README.md](./tui/README.md) to learn how to get information _into_ Ei, and [CLI README.md](./src/cli/README.md) to get it back _out_.

## What Does "Local First" Mean?

All of the data Ei learns about you from your conversations is stored on your device (LocalStorage on the Web, and `$EI_DATA_PATH` or `~/.local/share/ei` in the TUI).

Unless you enable Syncing, that's where it stays.

If you have a local LLM, literally no data leaves your system(s) by default. If you don't, you'll need to provide an LLM for Ei to use. I tried to make that as easy as possible via adding Providers via API Key.

There's no other usage, debugging, analytics, tracking, or history information stored or transmitted - anonymized or otherwise.

If there's a problem with the system, you need to tell me here on GitHub, or on Bluesky, or Discord, or whatever. There's no "report a bug" button, no "DONATE" link in the app.

Don't get me wrong - I absolutely want to fix whatever problem you run into, or hear about the feature you want - but your Ei system, and the data you build with it, is yours.

That's what "Local First" means.

### What Does Sync Do?

Optionally, you can choose to "Sync" to flare576.com. The only reason you would do this is if you wanted to easily move between two or more devices.

If you just want data back-ups, there's an "Backup & Restore" feature built into the system on the same page as "Sync" (actually, above Sync, because I honestly don't think anyone besides me wants to use Ei enough to use two devices...).

After you enable it, Sync kicks in when you close the TUI, or if you click "Save and Exit" in the web app. It sends a single, encrypted file to a file store for Ei...

That I can't decrypt.

Even if I wanted to (I definitely do not), I wouldn't be able to divulge your information because **You** are the only one that can generate the key. It's not a public/private keypair, it's not a "handshake".

It's *your* data - I have no right to it, and neither does anyone else except you.

## What's a Persona?

At the core of the technology, LLM "Agents" are made up of two or three components, depending on who you ask:

1. System Prompt
2. User Prompt (which can be broken into "Messages", but they're still basically the User Prompt)

The "System Prompt" is the part where you usually say

> You are a pirate

The "User Prompt" is the part where you put your messages

> user: "OMG ARE YOU REALLY A PIRATE?!"
> assistant: "Yar."

A "Persona" is the combination of these two pieces of data, plus some _personality_. The reason I didn't call it an "Agent" is because Personas aren't static<sup>1</sup> - they'll grow and adapt as you talk to them. See the [Core Readme](src/README.md) for more information!

> <sup>1</sup>: By default. You can make them static.

## What's a Room?

Rooms let you throw multiple personas into the same conversation thread. Chaos ensues. Or collaboration. Sometimes both.

Three modes, set at creation:

**Free For All (FFA)**: Everyone talks. Every message gets a response from every persona. It's loud. Good for brainstorming or when you want a bunch of perspectives on the same thing.

**Choose Your Path (CYP)**: The conversation branches. Each message triggers responses from all personas, but you pick which one continues the thread. Fork in the road, every turn. You're the navigator.

**Messages Against Persona (MAP)**: The interesting one. Everyone submits a response, but a Judge persona picks which one actually shows up. The personas have to stay in character and compete for the Judge's approval. The human doesn't have to play by the rules. It's partly a game of "who knows this judge best?" and partly just fun to watch them try.

Rooms learn the same way persona conversations do. Quotes, topics, people — all get extracted and persisted. The knowledge base grows no matter which mode you're in.

## The Basics

Ei can operate with three types of input, and three types of output.

```
[TUI] -User Messages-> Ei <-User Messages- [Web]
                       ^
                    Sessions
                       |
                   [OpenCode]
```

```
[TUI] <-Persona Messages- Ei -Persona Messages-> [Web]
                          |
                       CLI Data
                          v
                      [OpenCode]
```

Optionally, users can opt into a server-side data sync. This is ideal for users who want to use multiple devices or switch between TUI and Web throughout the day. All data is encrypted _before_ being sent to the server, using a key that only the user can generate (your `username` and `passphrase` never leave your device - I couldn't decrypt your data if I wanted to).

### Web

When you access Ei via https://ei.flare576.com, your browser will download the assets and walk you through onboarding. If you're running a Local LLM on port :1234 it will auto-detect it, otherwise it prompts you to enter one.

Then you'll land on the chat interface. As you enter messages, they'll go to *YOUR* server. As Ei discovers information about you, summaries will be built with *YOUR* server, and data will be stored to *YOUR* LocalStorage in *YOUR* browser.

When you leave, it simply stays in LocalStorage. When you come back, it loads it from LocalStorage.

More information can be found in the [Web Readme](web/README.md)

### TUI

```bash
# Install Bun (if you don't have it)
curl -fsSL https://bun.sh/install | bash

# Run Ei — no install needed, always the latest version
bunx ei-tui

# Or, if you use it as much as I do, add this to your profile!
alias ei='bunx ei-tui'
```

If you have a Local LLM, that's the first and last set of signals that leave your machine for Ei unless you tell it otherwise.

Regardless, running `ei` (or `bunx ei-tui`) pops open the TUI interface and, just like on the web, all messages and summary requests flow to your LLM provider, but the core data stays on your device.

More information (including commands) can be found in the [TUI Readme](tui/README.md)

### Coding Tool Integrations

Ei can import sessions from your coding tools and extract what you've been working on — pulling out facts, topics, and context that persist across sessions. Enable any combination; they work independently and feed into the same knowledge base.

All three integrations are enabled via `/settings` in the TUI.

#### OpenCode

```yaml
opencode:
  integration: true
```

OpenCode saves sessions as JSON or SQLite (depending on version). Ei reads them, extracts context per-agent (each agent like Sisyphus gets its own persona), and keeps everything current as sessions accumulate.

OpenCode can also *read* Ei's knowledge back out via the [CLI tool](src/cli/README.md) — making it a dynamic, perpetual RAG. That's why it always has context from your other projects.

#### Claude Code

```yaml
claudeCode:
  integration: true
```

Reads from `~/.claude/projects/` (JSONL session files). All sessions map to a single "Claude Code" persona. Tool calls, thinking blocks, and internal plumbing are stripped — only the conversational content is imported.

#### Cursor

```yaml
cursor:
  integration: true
```

Reads from Cursor's SQLite databases:
- **macOS**: `~/Library/Application Support/Cursor/User/`
- **Windows**: `%APPDATA%\Cursor\User\`
- **Linux**: `~/.config/Cursor/User/`

All sessions map to a single "Cursor" persona.

---

Sessions are processed oldest-first, one per queue cycle, so Ei won't overwhelm your LLM provider on first run. See [TUI Readme](tui/README.md)

## Built-in Tool Integrations

Personas can use tools. Not just read-from-memory tools — *actual* tools. Web search. Your music. Your filesystem. Here's what ships with Ei out of the box:

### Ei Built-ins (always available, no setup)

| Tool | What it does |
|------|-------------|
| `read_memory` | Semantic search of your personal memory — facts, traits, topics, people, quotes. Personas call this automatically when the conversation touches something they might know about you. Supports the `persona` filter to scope results to what a specific persona has learned. |
| `file_read` | Read a file from your local filesystem *(TUI only)* |
| `list_directory` | Explore folder structure *(TUI only)* |
| `directory_tree` | Recursive directory tree *(TUI only)* |
| `search_files` | Find files by name pattern *(TUI only)* |
| `grep` | Search file contents by regex *(TUI only)* |
| `get_file_info` | File/directory metadata *(TUI only)* |

The filesystem tools make Ei a legitimate coding assistant in the TUI. Ask a persona to review a file, understand a project structure, or track down where something is defined — it can actually look.

### Tavily Web Search (requires free API key)

| Tool | What it does |
|------|-------------|
| `tavily_web_search` | Real-time web search — current events, fact-checking, anything that needs up-to-date information |
| `tavily_news_search` | Recent news articles |

Get a free key at [tavily.com](https://tavily.com) (1,000 requests/month free tier). Add it in **Settings → Tool Kits → Tavily Search**.

### Spotify (requires OAuth connection)

| Tool | What it does |
|------|-------------|
| `get_currently_playing` | What's playing right now — artist, title, album, progress |
| `get_liked_songs` | Your full liked songs library |

Connect in **Settings → Tool Kits → Spotify**. Once connected, personas can ask what you're listening to and actually know. Music-aware conversations.

### Assigning Tools to Personas

Tools aren't global — you choose which personas get access. Edit a persona and toggle the tools it can use. A focused work persona might only have filesystem tools. A general-purpose companion might have everything.

---

## Technical Details

This project is separated into five (5) logical parts:

| Part | Location | Purpose | Deployed To |
|------|----------|---------|-------------|
| Ei Core | `/src` | Shared between TUI and Web. The event-driven core of Ei, housing business logic, prompts, and integrations. | (library) |
| Ei Online | `/web` | Web interface for Ei. | https://ei.flare576.com |
| Ei Terminal UI (TUI) | `/tui` | TUI interface for Ei. | NPM for you to install |
| Ei API | `/api` | Remote sync for Ei. | https://ei.flare576.com/api |
| Ei CLI | `/src/cli` | CLI interface for Opencode to use as a tool. Technically ships with the TUI. | (ships with TUI) |

## Requirements

- [Bun](https://bun.sh) runtime (>=1.0.0) — install with `curl -fsSL https://bun.sh/install | bash`
- A local LLM (LM Studio, Ollama, etc.) OR API access to a cloud provider (Anthropic, OpenAI, Bedrock, your uncle's LLM farm, etc.)

## LM Studio Setup

**Important**: You must enable CORS in LM Studio for browser-based EI to work.

1. Open LM Studio
2. Go to **Local Server** tab (left sidebar)
3. Enable **"Enable CORS"** toggle
4. Start/restart the server

Without this setting, browser security policies will block API calls.

## Development

To run the full test suite on a new machine:

```bash
nvm install 20
nvm use 20
npm install
cd web && npm install && npx playwright install && cd ..
cd tui
bun install
npm install
npm rebuild   # compile native PTY module for Node 20 (one-time, new machine only)
cd ..
nvm use default
npm install
npm run test:all
```

## Releases

Tag a version to publish automatically:

```bash
# bump version in package.json
git commit -am "chore: bump to v0.1.4"
git tag v0.1.4
git push && git push --tags
```

GitHub Actions picks up the tag and publishes to npm with provenance via OIDC. No stored secrets.

## Project Structure

See `AGENTS.md` for detailed architecture and contribution guidelines.
