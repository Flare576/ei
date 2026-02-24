# Ei Online
I didn't intentionally make the two parts "Ei, Ei:O", but when I realized that I had, I certainly made no effort to avoid it.

Old MacDonald doesn't own vowels, OK?

---

## First Time Here?

Ei walks you through setup — no account, no sign-in required. Here's what to expect:

**Step 1 — Local LLM check**: Ei looks for a local AI model running on your machine (LM Studio, Ollama, etc). If it finds one, you're up and running privately with zero data leaving your device. If not, no worries.

**Step 2 — Add a provider**: Tell Ei where your AI comes from. This can be a local model or a cloud provider like OpenAI, Anthropic, or Google. You'll need an API key for cloud providers. You can add as many as you want and switch between them later.

**Step 3 — Meet Ei**: Your default companion is ready. Start chatting. Ei will introduce themselves and start learning about you.

> Already using Ei on another device? Enter your username and passphrase on the welcome screen to restore your data.

---

## What You Can Do

### Talk to Personas

The left panel is your persona list. Click any persona to open a conversation. Ei is always there as your default — they see everything across all your personas and help you navigate the system.

To **add a new persona**, click the `+` button at the top of the persona panel. Give them a name and a personality, and they're ready to chat.

To **edit a persona** — their traits, topics, or settings — hover over their name in the list and click the pencil icon.

### Manage Your Data

As you chat, Ei builds up a picture of you: facts, personality traits, people in your life, and topics you care about. You can view and edit all of this directly.

Open the **☰ menu** (top-right) → **My Data**. You'll see tabs for:

- **Facts** — Things Ei knows about you ("You live in Austin", "You prefer dark mode")
- **Traits** — How you tend to think and communicate
- **Topics** — Subjects you care about, with context on your interest level
- **People** — Friends, family, colleagues Ei has learned about
- **Quotes** — Memorable things you or your personas have said

You can edit, add, or delete anything here. Your personas read this context when they respond to you.

### Settings

Open the **☰ menu** → **Settings** to:

- Add, edit, or remove LLM providers
- Set a default model (used for background processing and new personas)
- Set up **sync** so you can use Ei on multiple devices
- **Export** your data as a backup, or **Import** a backup to restore

### Sync & Privacy

Ei stores everything in your browser's local storage — nothing leaves your device unless you turn on sync.

If you enable sync, your data is **encrypted before it's sent**, using a key derived from your username and passphrase. The server stores an encrypted blob it cannot read. Even I can't decrypt your data.

To set up sync: **☰ menu** → **Settings** → Sync section → enter a username and passphrase. Once saved, Ei syncs when you click **Sync & Exit** from the menu.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Pause / unpause all processing |
| `Ctrl+H` | Focus persona panel |
| `Ctrl+L` | Focus message input |
| `↑` / `↓` | Navigate personas (when panel is focused) |
| `Enter` | Send message / select persona |
| `Shift+Enter` | New line in your message |
| `Ctrl+C` | Clear input |
| `↑` (at start of input) | Recall your last unsent message |
| `Page Up` / `Page Down` | Scroll chat history |

---

## Tips

- Hover over a persona to see quick actions: pause, edit, archive, delete
- Pausing stops all AI processing immediately but preserves your messages — press `Escape` or click the pause button
- The save system is automatic — but use **Export** from Settings before making big changes, just in case
- Markdown works in messages (bold, italics, code blocks, etc.)
