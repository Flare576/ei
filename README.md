# Ei

Ei can be a LOT of different things, but it's always going to be **YOURS** - [Local First](#what-does-local-first-mean)

**What are you hoping to do with Ei today?**

## I Want To Give My Coding Agents Memory

You'll want to start with [Getting Data From Coding Tools](#coding-tool-integrations), then learn a little about [Installing Coding Tool Extensions](./tui/README.md#installation).

## I Want My Coding Agents To Have Personality

I've started using terms like [Persona and Agent](#whats-a-persona). To get your agents to be more like Personas, you talk to them in the [TUI](./tui/README.md). Define what they're like, spend time with them, and they'll evolve — picking up facts, opinions, and context about you as you go. The [Personas section of the TUI README](./tui/README.md#personas) covers the commands you can use to work with Persona, and [What's a Persona](#whats-a-persona) explains the fields/Identity.

## I Want My Persona To Remember Me

Ei is, at its core, a memory system. It compiles Facts, People, Topics, and Quotes in your life and surfaces them to Agents and Persona naturally. Simply spending time in Ei or adding integrations [like Coding tools](#coding-tool-integrations) or [Slack](#slack-integration) will help it grow faster<sup>1</sup>!

><sup>1</sup> It should be noted - again - that all of the data Ei gathers stays with [**YOU**](#what-does-local-first-mean)

## I Want My Persona To Talk To Each Other

Ei features a "Rooms" concept, where you can put your Persona into a shared context space and they'll "see" all the messages in several different formats. They all maintain their Identity (Traits, Descriptions, Topics), see the other participants, and still access the shared knowledge base.

## I Want To Use the TUI and the Web

I built a [Sync](#what-does-sync-do) feature for this - it works using an encryption key only you know, before the data leaves your machine. When you sync data with Ei, you're basically just sharing your JSON data file between two machines. You don't **NEED** to use Sync - you can just send the file around!

## Getting Started

- **Web** — Go to [ei.flare576.com](https://ei.flare576.com) — it'll walk you through onboarding.
- **TUI** — Install [Bun](https://bun.sh) if you don't have it, then run `bunx ei-tui`. Full setup details in the [TUI README](./tui/README.md).

## Coding Tool Integrations

Ei can import sessions from your coding tools and extract what you've been working on — pulling out facts, topics, and context that persist across sessions. Enable any combination; they work independently and feed into the same knowledge base.

Supported tools: OpenCode, Claude Code, Cursor, Codex, and Pi/OMP. Full setup in the [TUI README → Coding Tool Integrations](./tui/README.md#coding-tool-integrations).

## Document Import

Got notes, journals, markdown files? You can feed them directly to Ei.

**Web**: Open **☰ menu** → **My Data** → **Documents** tab. Drop a `.txt`, `.md`, or `.markdown` file and Ei gets to work.

**TUI**:
```bash
/import ~/notes/my-journal.md
/import /path/to/report.pdf
```

Ei splits the document into segments, runs them through the extraction pipeline, and pulls out facts, topics, people, and quotes — exactly like it does with your conversations. The extracted knowledge is attributed to a reserved persona called **Emmett** so it doesn't pollute your chat history.

Both surfaces show you which documents have been imported and let you remove their extracted knowledge (web: Delete button in the Documents tab; TUI: `/unsource <source_tag>`).

## Slack Integration

Ei can index your Slack workspace — channels, DMs, and threads — and extract the same topics, people, and context it pulls from your conversations. Your personas end up knowing what's been going on at work without you having to explain it.

**Web**: Open **☰ menu** → **My Data** → **External** tab → **Connect Slack**.

TUI setup: `/auth slack` — see the [TUI README → Slack Integration](./tui/README.md#slack-integration) for details.

Ei is read-only — it never posts, reacts, or takes any action in your workspace. All processing happens locally. Your workspace admin may need to approve the [Ei Slack app](https://slack.com/oauth/v2/authorize?client_id=11080256060354.11080294064034&scope=&user_scope=channels:history,channels:read,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,users:read,users:read.email) before you can connect.

## Knowledge Share

Sometimes you want to take what Ei knows and turn it into something you can hand to another human. A new teammate joining a project. A briefing doc before a meeting. A brain dump before a vacation.

**TUI**:
```bash
/generate everything about the Uniform project
/generate comprehensive runbook for the IDP deployment issues
```

Give it a subject description and Ei searches its memory, chases down related entities, and synthesizes a clean markdown document using your `rewrite_model` (an Opus-class model is recommended — it'll warn you if you're about to use something less capable). The document lands in `$EI_DATA_PATH/docs/` automatically.

`/generate` with no args opens a list of your existing generated documents where you can re-run, re-export, or delete them.

**Web**: Open **☰ menu** → **My Data** → **Documents** tab. Click **Generate**, enter a subject, and Ei does the rest. Generated docs appear in the same list as imported ones.

## Built-in Tool Integrations

Personas can use tools. Not just read-from-memory tools — *actual* tools. Web search. Your music. Your filesystem. Here's what ships with Ei out of the box:

### Ei Built-ins (always available, no setup)

| Tool | What it does |
|------|-------------|
| `find_memory` | Semantic search of your personal memory — facts, traits, topics, people, quotes. Personas call this automatically when the conversation touches something they might know about you. Supports the `persona` filter to scope results to what a specific persona has learned. |
| `fetch_memory` | Full-record lookup for a specific human entity (Fact, Topic, Person, or Quote) by ID. Use after `find_memory` to retrieve complete details. |
| `fetch_message` | Retrieve a specific message by fully-qualified ID with optional surrounding context. Searches Ei conversations and supported external coding-session stores. |
| `file_read` | Read a file from your local filesystem *(TUI only)* |
| `list_directory` | Explore folder structure *(TUI only)* |
| `directory_tree` | Recursive directory tree *(TUI only)* |
| `search_files` | Find files by name pattern *(TUI only)* |
| `grep` | Search file contents by regex *(TUI only)* |
| `get_file_info` | File/directory metadata *(TUI only)* |
| `web_fetch` | Fetch a URL and return its text content *(TUI only — blocked by CORS in browsers)* |

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

## How Ei Works

Ei can operate with three types of input, and three types of output.

```
[TUI] -User Messages-> Ei <-User Messages- [Web]
                       ^
                    Sessions
                       |
          [OpenCode / Claude Code / Cursor / Codex]
```

```
[TUI] <-Persona Messages- Ei -Persona Messages-> [Web]
                          |
                       CLI Data
                          v
              [OpenCode / Claude Code / Cursor / Codex]
```

Optionally, users can opt into a server-side data sync. This is ideal for users who want to use multiple devices or switch between TUI and Web throughout the day. All data is encrypted _before_ being sent to the server, using a key that only the user can generate (your `username` and `passphrase` never leave your device - I couldn't decrypt your data if I wanted to).

### Web

Go to [ei.flare576.com](https://ei.flare576.com) and it'll walk you through onboarding. More in the [Web README](web/README.md).

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

## Philosophy

### What Does "Local First" Mean?

All of the data Ei learns about you from your conversations is stored on your device (LocalStorage on the Web, and `$EI_DATA_PATH` or `~/.local/share/ei` in the TUI).

Unless you enable Syncing, that's where it stays.

If you have a local LLM, literally no data leaves your system(s) by default. If you don't, you'll need to provide an LLM for Ei to use. I tried to make that as easy as possible via adding Providers via API Key.

> **One honest note**: the first time you load Ei in a browser, it downloads the embedding library and model weights from public CDNs (jsdelivr, HuggingFace). Those CDNs see your IP address — but not your data. All embedding runs locally in your browser after that first download. The TUI version caches everything on first run and is fully offline after. Additionally, the same is true for my webhost - it must see your IP address to serve you assets, but no analytics, reports, metrics, etc. are done on them.

There's no other usage, debugging, analytics, tracking, or history information stored or transmitted - anonymized or otherwise.

If there's a problem with the system, you need to tell me here on GitHub, or on Bluesky, or Discord, or whatever. There's no "report a bug" button, no "DONATE" link in the app.

Don't get me wrong - I absolutely want to fix whatever problem you run into, or hear about the feature you want - but your Ei system, and the data you build with it, is yours.

That's what "Local First" means.

#### What Does Sync Do?

Optionally, you can choose to "Sync" to flare576.com. The only reason you would do this is if you wanted to easily move between two or more devices.

If you just want data back-ups, there's an "Backup & Restore" feature built into the system on the same page as "Sync" (actually, above Sync, because I honestly don't think anyone besides me wants to use Ei enough to use two devices...).

After you enable it, Sync kicks in when you close the TUI, or if you click "Save and Exit" in the web app. It sends a single, encrypted file to a file store for Ei...

That I can't decrypt.

Even if I wanted to (I definitely do not), I wouldn't be able to divulge your information because **You** are the only one that can generate the key. It's not a public/private keypair, it's not a "handshake".

It's *your* data - I have no right to it, and neither does anyone else except you.

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
git commit -am "chore: bump to v1.0.0"
git tag v1.0.0
git push && git push --tags
```

GitHub Actions picks up the tag and publishes to npm with provenance via OIDC. No stored secrets.

> **Note**: Run the pre-flight checklist in `AGENTS.md` (or use the `release` skill in OpenCode) before tagging. The v0.1.9 incident is a cautionary tale.

## Project Structure

See `AGENTS.md` for detailed architecture and contribution guidelines.
