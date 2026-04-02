# Thundersorter

Automatically sort and tag your emails in Thunderbird using AI.

Thundersorter classifies incoming email into categories like finance, newsletters, shipping, and more. Tags show up right in Thunderbird so you can filter, search, and organize your inbox without lifting a finger.

No server, no terminal, no setup scripts. Just install the add-on and paste your API key.

## Getting started

### 1. Get an API key

Pick any provider you like. You only need one:

- **Gemini** (free tier available) -- https://aistudio.google.com/apikey
- **OpenAI** -- https://platform.openai.com/api-keys
- **Anthropic** -- https://console.anthropic.com/settings/keys
- **Fireworks** -- https://fireworks.ai
- **OpenRouter** -- https://openrouter.ai
- **Groq** -- https://groq.com
- **Together** -- https://together.ai
- **Ollama** (local, no key needed) -- https://ollama.com

### 2. Install the add-on

1. Open Thunderbird
2. Go to **Add-ons and Themes** (from the hamburger menu)
3. Click the gear icon and choose **Install Add-on From File...**
4. Select the `thundersorter.xpi` file

### 3. Add your API key

1. Go to **Add-ons > Thundersorter > Preferences**
2. Pick your provider from the dropdown
3. Paste your API key
4. Click **Save**

That's it. The best available model is selected automatically. New mail will be tagged as it arrives.

## Using it

- **New mail is tagged automatically** as it arrives
- **Tag a whole folder** by clicking the Thundersorter button in the toolbar
- **Tag specific messages** by right-clicking and choosing *Classify with Thundersorter*

## Changing settings

Everything is in the add-on preferences (Add-ons > Thundersorter > Preferences):

- **Switch providers** -- pick a different one from the dropdown, enter your key, save
- **Pick a specific model** -- click *Advanced options* to browse all available models from your provider
- **Edit tag categories** -- add or remove tags to match how you organize email

## Updates

Thundersorter checks for updates automatically through Thunderbird's built-in add-on update system. When a new version is published, Thunderbird will install it for you.
