# Ei

A local-first AI companion system with persistent personas.

## What Does "Local First" Mean?

By default, I don't pull analytics, usage information, debugging information, anonymized or otherwise. The only data I get from you is the bare minimum my host needs to deliver web assets to you (your public IP address, basically), or what NPM pulls from you when you install that way.

If you have a local LLM, literally no data leaves your system(s) by default. If you don't, you'll need to provide an LLM for Ei to use. I tried to make that as easy as possible via adding Providers via API Key.

### What Does Sync Do?

Optionally, you can choose to "Sync" to flare576.com. This is done in as a single, encrypted file.

That I can't decrypt. Even if I wanted to (I definitely do not), I wouldn't be able to divulge your information because **You** are the only one that can generate the key. It's not a public/private keypair, it's not a "handshake".

It's your data - I have no right to it, and neither does anyone else except you.

## What's a Persona?

At the core of the technology, LLM "Agents" are made up of two to three components:

1. System Prompt
2. User Prompt
    a. Which can be broken into "Messages", but they're still basically the User Prompt

The "System Prompt" is the part where you usually say

> You are a pirate

The "User Prompt" is the part where you put your messages

> user: "OMG ARE YOU REALLY A PIRATE?!"
> assistant: "Yar."

A "Persona" is the combination of these two pieces of data. The reason I didn't call it an "Agent" is because Personas aren't static<sup>1</sup> - they'll grow and adapt as you talk to them. See the [Core Readme](core/README.md) for more information!

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

When you access Ei via https://ei.flare576.com, your browser will download the assets and walk you through onboarding. If you're running a Local LLM on port :1234 it will auto-detect it, otherwise it will  allowing you to enter it.

Then you'll land on the chat interface. As you enter messages, they'll go to *YOUR* server. As Ei discovers information about you, summaries will be built with *YOUR* server, and data will be stored to *YOUR* LocalStorage in *YOUR* browser.

When you leave, it simply stays in LocalStorage. When you come back, it loads it from LocalStorage.

More information can be found in the [Web Readme](web/README.md)

### TUI

When you `npm install -g ei-tui`, you pull down this package and it's dependencies.

If you have a Local LLM, that's the first and last set of signals that leave your machine for Ei unless you tell it otherwise.

Regardless, Running `ei` pops open the TUI interface and, just like on the web, all messages and summary requests flow to your LLM provider, but the core data stays on your device.

More information (including commands) can be found in the [TUI Readme](tui/README.md)

### Opencode

Opencode saves all of its sessions locally, either in a JSON structure or, if you're running the latest version, in a SQLite DB. If you enable the integration, Ei will pull all of the conversational parts of those sessions and summarize them, pulling out details, quotes, and keeping the summaries up-to-date.

Then, Opencode can call into Ei and pull those details back out.

Yes, I did make a dynamic, perpetual RAG. No, I didn't do it on purpose; that's why you always have a side-project or two going.

## Technical Details

This project is separated into five (5) logical parts:

1. Ei Core
    a. Location: `/src`
    b. Purpose: Shared between TUI and Web, it's The event-driven core of Ei, housing:
        i. Business logic
        ii. Prompts
        iii. Integrations
2. Ei Online
    a. Location: `/web`
    b. Purpose: Provides a web interface for Ei.
    c. Deployed to: https://ei.flare576.com
3. Ei Terminal User Interface (TUI)
    a. Location: `/tui`
    b. Purpose: Provides a TUI interface for Ei
    c. Deployed to: NPM for you to install
4. Ei API
    a. Location: `/api`
    b. Purpose: Provides remote sync for Ei.
    c. Deployed to: https://ei.flare576.com/api
5. Ei Command Line Interface (CLI)
    a. Location: `/src/cli`
    b. Purpose: Provides a CLI interface for Opencode to use as a tool
    c. Technically, ships with the TUI

## Requirements

- Node.js 18+
- Local LLM provider (LM Studio, Ollama, etc.)
    * OR API access to a remote LLM host (OpenCode, Anthropic, OpenAi, Bedrock, your uncle's LLM farm, etc.)

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
