# Ei

A local-first AI companion system with persistent personas and Opencode Integration.

You can access the Web version at [ei.flare576.com](https://ei.flare576.com).

You can install the local version via `npm install -g ei-tui` (see [### TUI](#tui) for details).

If you're here to give Opencode perpetual memory (yes), jump over to [TUI README.md](./tui/README.md) to learn how to get information _into_ Ei, and [CLI README.md](./src/cli/README.md) to get it back _out_.

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

# Install Ei
npm install -g ei-tui
```

When you install Ei, you pull down this package and it's dependencies.

If you have a Local LLM, that's the first and last set of signals that leave your machine for Ei unless you tell it otherwise.

Regardless, Running `ei` pops open the TUI interface and, just like on the web, all messages and summary requests flow to your LLM provider, but the core data stays on your device.

More information (including commands) can be found in the [TUI Readme](tui/README.md)

### Opencode

Ei gives OpenCode a persistent memory. Yes, this is a dynamic, perpetual RAG — I didn't plan it that way, but here we are.

Opencode saves all of its sessions locally, either in a JSON structure or, if you're running the latest version, in a SQLite DB. If you enable the integration, Ei will pull all of the conversational parts of those sessions and summarize them, pulling out details, quotes, and keeping the summaries up-to-date.

Then, Opencode can call into Ei and pull those details back out. That's why you always have a side-project or two going. See [TUI Readme](tui/README.md)

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

```bash
npm install
npm run dev      # Watch mode
npm run build    # Compile TypeScript
npm run test     # Run tests
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
