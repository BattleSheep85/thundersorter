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

### 2. Install the add-on

1. Open Thunderbird
2. Go to **Add-ons and Themes** (from the hamburger menu)
3. Click the gear icon and choose **Install Add-on From File...**
4. Select the `thundersorter.xpi` file

### 3. Add your API key

1. Go to **Add-ons > Thundersorter > Preferences**
2. Pick your provider from the dropdown
3. Paste your API key
4. Click **Test Connection** to verify
5. Click **Save**

That's it. New mail will be tagged automatically as it arrives.

## Using it

- **New mail is tagged automatically** as it arrives
- **Tag a whole folder** by clicking the Thundersorter button in the toolbar
- **Tag specific messages** by right-clicking and choosing *Classify with Thundersorter*

## Changing settings

Everything is in the add-on preferences (Add-ons > Thundersorter > Preferences):

- **Switch providers** -- pick a different one from the dropdown, enter your key, save
- **Change the model** -- edit the model name field (defaults are fine for most people)
- **Edit tag categories** -- add or remove tags to match how you organize email
- **Add custom providers** -- services like Fireworks, OpenRouter, Ollama, and others work too. Click *Add* under Custom Providers, give it a name, then fill in the base URL, API key, and model

## Supported providers

| Provider | Type | Notes |
|----------|------|-------|
| Gemini | Built-in | Free tier available |
| OpenAI | Built-in | GPT-4.1 mini by default |
| Anthropic | Built-in | Claude Haiku by default |
| Fireworks | Custom | OpenAI-compatible |
| OpenRouter | Custom | OpenAI-compatible |
| Ollama | Custom | Local models, no API key needed |
| Together | Custom | OpenAI-compatible |
| Groq | Custom | OpenAI-compatible |

Any service that uses the OpenAI chat completions API format can be added as a custom provider.
