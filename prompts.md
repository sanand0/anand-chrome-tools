# Prompts

## Scaffolding, 04 Oct 2026

<!-- Edge anand-chrome-tools monolith extension: https://chatgpt.com/c/6ac25592-35f4-83ec-9501-ef41f0b49ba5 (2026-10-05T08:19:42+08:00) -->

Does Edge / Chrome have a shortcut where I can press a key combination and it will open a specific URL right AFTER the current tab? Or, whta's the cleanest, easiest way to achieve this?

---

How much additional memory / CPU / GPU / other resources does each extra extension take? Am I better of creating one extension per task or group extensions into fewer numbers or even go for a monolithic "Anand's extension for everything" kind of an approach? Think, research, use relevant skills, ...

---

Take a look at my "Global browser shortcuts" conversation a short while ago. I wanted that to implement a music player for myself. I expect I would want a few other kinds of capabilities in my anand-chrome-tools extension.

I will plan to create this in ~/code/anand-chrome-tools/ on [LocalMCP2](/plugins/plugin_asdk_app_6ab0b6c561508191882e58b23665db3e)

Suggest a file structure, architecture, approach, etc. by researching best practices for organizing personal extensions with diverse capabilities. Keep in mind that I value simplicity (flat is better than deeply nested, fewer files, simple and easy to maintain, minimal features, etc.)

Create a minimal scaffolding and a minimal AGENTS.md in the repo based on AGENTS.md best practices and other scaffolding (including tests) required for such a repo and initialize a git repo. No need to actually create any of the extension features.

<!-- At this point, I decided to park it because I found alternatives:

- Ctrl+Alt+C to open ChatGPT in a new tab. Using rofi + edge. https://chatgpt.com/c/6ac23b21-284c-83ec-b443-8aa80f6962f9
- Global shortcut keys for music player. Building ~/code/tools/music/ - https://chatgpt.com/c/6ac2ec99-9728-83ec-99ef-7bde50d81976
- Keyboard shortcuts to run specific bookmarklets. #TODO

I plan to accumulate more requirements and then build this.

-->
