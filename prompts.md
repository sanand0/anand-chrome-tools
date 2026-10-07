# Prompts

## Add filesystem access, 07 Oct 2026

<!-- Extension File Access Implementation: https://chatgpt.com/c/6ac58504-82f8-83ec-bd3c-4892ff71e236 (2026-10-07T08:09:44+08:00) -->

Can a Chrome/Edge browser extension like [LocalMCP2](/plugins/plugin_asdk_app_6ab0b6c561508191882e58b23665db3e) ~/code/anand-chrome-tools/ get permission to be able to read, write, append to files in a local directory? I'd like to maintain a log of actions, etc. in a local directory. What would it take to do that? I mean, does the user give permissions upfront during installation or something else? How do users specific WHICH directory to allow access for and how can they change that? What's the easiest way to implement this in ~/code/anand-chrome-tools?

Treat these as sample use cases I'm solving for (though I'll likely add much more to the directory).

* Whenever the user performs an action, I will log it in actions.jsonl
* The user can annotate any website and I'll store that in notes.jsonl and it'll be visible when they open that page

For anything you're unsure of, feel free to test and verify. But when using agent-browser with CDP localhost:9222 try using background operations (see devtools skill) as much as possible, to avoid disturbing my browser, and avoid changing tabs you didn't open.

---

OK. Implement the settings page (elegant, lightweight & minimal) and action logs. I don't need action logs to be synced on every action - just once daily is sufficient. It might be good if the extension reads from the directory on load, saves once daily or on exit (if there are any new actions to save). In that sense, a monthly (UTC) JSONL is probably fine. The extension has to maintain new actions in memory (or local storage) and save them periodically. It also needs to maintain the action usage counts - probably in memory (or local storage).

Think about the simplest, most lightweight (resource-wise AND code-wise) implementation. Explore alternatives & test if you think them worthwhile, pick what emerges as the best approach, and document your rationale.

Run and test - or let me know what to do and I'll test it.


## Add command palette, 05 Oct 2026

<!-- Browser Shortcut Bookmarklet: https://chatgpt.com/c/6ac37a30-8230-83ec-b56f-562b355c0a96 (2026-10-06T06:52:11+08:00) -->

Is there a way I can press a shortcut in Edge / Chrome and it triggers a specific bookmark (which in my case is a bookmarklet)? Or, what're the closest alternatives?

---

I'd like something like a VS Code command palette. I invoke it, and it can execute different kinds of actions from different sources. In this case, selecting from and executing a bookmarklet is one. There may be other kinds of actions I might add in the future. Does something like this already exist, or should I plan to implement this in my anand-chrome-tools extensions?

---

OK, let's ideate. Apart from running bookmarklets, what other capabilities do other tools expose that'll likely be useful for me - given my kind of usage? Explore [LocalMCP2](/plugins/plugin_asdk_app_6ab0b6c561508191882e58b23665db3e) for browser-related patterns, my browsing history for sites I visit, extensions I use, etc.

I would like to use Ctrl+Shift+P (can I remap it from the print command to a palette?) to open a palette sort of like my rofi tools in ~/code/scripts/ and expose different kinds of selectors - such as running a bookmarklet (any bookmark from my Bookmarklets folder in the bookmarks toolbar) and more. What more is what I'd like to understand. Use relevant skills and prioritize by usefulness x frequency.

---

Add a Command Palette tool to ~/code/anand-chrome-tools. Pressing `Ctrl+Shift+[` (to avoid conflict with `Ctrl+Shift+P` and other native shortcuts) should open a VS Code style palette (with a similar fuzzy search - prioritize exact matches)

It should allow searching for and executing the following:

- Open tabs across windows (prefix: @)- by title, tab group, and URL: switch to the tab
- Bookmarklets - by name (prefix: !): execute the bookmarklet
- Commands - by name (prefix: >):
- Copy current page: Copy [title](URL) to clipboard
- Toggle Github: Switch between a Github repo and its corresponding GitHub Pages site (if applicable)
- Repeat last command

Log all commands with timestamp and allow exporting the logs. When searching, prioritize frecent commands. Research the best way to do this and base it on what tools with the best UX have implemented.

---

Let's skip `Ctrl+Shift+[` - I am OK to use a different shortcut. Any recommendations that doesn't have any conflicts?

This doesn't show any bookmarklets even though my bookmarks folder as a Bookmarklets subfolder has a series of bookmarklets. Why?

When I type "One punch" the tab titled "One-punch man" isn't highlighted. "ideas pi" doesn't match the tab "Pi Durable Ideas". VS Code would match words and things like that. How do we fix this?

Share suggestions - don't implement yet. I'll guide you from there.

---

Let's implement Ctrl+Shift+Space as the shortcut and completely abandon `Ctrl+Shift+[`.

Fix the bookmarklet bug.

Research more extensively for the ways fuzzy searches of this kind work. Pick something that's known to work well and people prefer strongly AND is simple. Implement that.

---

I see the bookmarklets but they don't actually get executed.

---

Clean up any cruft / redundant code, streamline it, refactor to be more elegant and concise where possible, ensure the test cases pass, document from an end-user perspective first, then from a developer perspective, and create a single commit for the working code.

<!-- commit: 393139c -->

Sometime, `Ctrl+Shift+Space`doesn't trigger the plugin.

It certainly doesn't work when I've loaded the extension and visit a page that was opened before the extension was loaded. But my computer went to sleep overnight and I returned to this tab - which I'm reasonably sure (but not 100% sure) was reloaded after the extension was loaded, and it didn't trigger the plugin - but it worked after the reload.

Is there a more reliable, robust mechanism to intercept the keyboard shortcut? Ideally something that would work even on tabs opened before the extension was installed? If required, I'm happy to change the keyboard shortcut - if you can let me know the set of shortcuts that would work reliably for such an approach.

---

OK, implement inject-on-demand and your other recommendations. Use this as an opportunity to simplify / shorten the code while improving readability.

---

A subtle issue. When I trigger the popup, it shows a list of matches. If my mouse happens to hover over one, that's the one that's selected - even if it's not the first match - and is activated when I press enter. I prefer the selected item be the first match, which I can manipulate through up/down arrow keys, and the hover can still visually highlight an element but should require a click rather than automatically selecting the hover-ed item and when I hover over some item and press enter, the SELECTED item, not the hovered item, should be activated. It'll be good to use different visual highlighting mechanisms for selection vs hover, which hover being subtler.

---

On the right side of each match, could you also show whatever frequency of usage metric you're using, where available? For example, if it was clicked 4 times in the last quarter, then maybe "4 / Q" with 4 prominent? Or any visually appealing interface that shows the number not-overtly-prominently and the time period subtly.



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
