# Prompts

## Fix lingering 🟡 in ChatGPT capture, 20 Nov 2026

<!--
cd ~/code/anand-chrome-tools
codex --model gpt-6.2-sol --config model_reasoning_effort=high
-->

I opened every ChatGPT chat that had a 🟡 on the browser and scrolled through it end to end. Yet, still, some 🟡 are reported by `~/code/scripts/chatcli backup`.
Why, and how can we fix it?

--- <!-- steering -->

FYI, most of the 🟡 seem like long scrolling pages.

--- <!-- steering -->

You may make changes in anand-chrome-tools or in chatcli backup - whichever is more appropriate.

---

Remove the review retained snapshots feature. I don't want to review chats. I will be using the export / dump from ChatGPT to replace it later anyway. Same for Claude.

<!-- codex resume 01a1f647-5372-7a60-81aa-37baea7a4eb7 -->

## Improve ChatGPT capture, 19 Nov 2026

<!--
cd ~/code/anand-chrome-tools
codex --model gpt-6.2-sol --config model_reasoning_effort=high
-->

Diagnose why some ChatGPT chats appear in chatgpt-raw/catalog.json without a saved snapshot. Reopening 6afe4f2d-9980-83ec-b87b-7946f38d689a in a fresh tab produced a valid snapshot. In the same authenticated browser, use disposable chats to compare initial generation and follow-ups in a fresh tab and a long-lived tab, then reopen a missed chat. For each case, trace what ChatGPT sends, what the observer sees, what reaches the queue, and what gets saved. Report the first stage where data is missing and the smallest fix the evidence supports. Keep capture passive. Also retain titles from observed list responses in {updateTime, title} catalog entries and support existing numeric entries.

---

I reloaded the extension.

Improve passive ChatGPT backups so `~/code/scripts/chatcli backup` can use the finalized active branch even when ChatGPT sends a follow-up as a stream and never fetches a fresh conversation snapshot. Use the findings from Codex session 01a1f34e-f870-72c1-884e-1d4ed559fcd4.

First, use disposable chats in the authenticated browser to check whether ChatGPT exposes the finalized branch in browser state after generation. Test a new chat, a follow-up, and an edit or regeneration. Compare the captured message IDs and visible content with the UI and a native snapshot obtained by reopening the chat.

If there’s a reliable source, capture the finalized branch passively and reuse the existing snapshot validation and versioning. Preserve raw stream records. Record the server conversation ID, request parent ID, final message ID, whether [DONE] was seen, and how the reader ended. A reader abort after [DONE] must remain distinguishable from an interrupted generation.

Keep capture opt-in and make no extra ChatGPT requests during ordinary browsing. If the finalized branch is unavailable or ambiguous, retain the stream evidence and report the gap. Verify what reaches disk and what chatcli backup --dry-run --verbose can use.

<!-- codex resume 01a1f34e-f870-72c1-884e-1d4ed559fcd4 -->

## Clean up the last commit, 18 Nov 2026

<!--
cd ~/code/anand-chrome-tools
codex --model gpt-6.2-sol --config model_reasoning_effort=high
-->

Clean up the last commit. We might not need verifications, historical checks, etc. Only what's required for the final state of the extension to work fine. Rewrite the last commit accordingly. Also include prompts.md in the commit.

<!-- codex resume 01a1ec18-a9ca-7fa1-a810-bc2010a5963e -->

## Backup ChatGPT and Claude, 17 Nov 2026

<!--
cd ~/code/anand-chrome-tools
codex --model gpt-6.1-sol --config model_reasoning_effort=high
-->

<!-- Source: Backup ChatGPT on anand-chrome-tools https://chatgpt.com/c/6afbd496-4600-83ec-adda-bbff4cfa3ba0 -->

```markdown
Enhance anand-chrome-tools to automatically back up my ChatGPT conversations as I browse.

## Intent

ChatGPT is one of my primary knowledge repositories. I want a reliable, local, machine-readable replica of my conversations that I can search, analyze and post-process for years, even as ChatGPT's features evolve.

I use ChatGPT several times a day. I'm comfortable with eventual consistency (a few hours), occasional omissions, and manually opening conversations created on other devices to back them up.

Optimize for correctness, completeness, simplicity, robustness and negligible browsing overhead — not real-time synchronization.

## Approach

Prefer passive capture of the structured conversation data ChatGPT already receives during my ordinary browsing. Make no additional requests to ChatGPT.

Research and observe how the current ChatGPT web application loads and updates conversations before deciding on the implementation.

Some useful starting points:

- https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts
- https://github.com/jameschen83/chatgpt_pane_control
- https://github.com/sanidhyasin/chatgpt-usage-capture
- https://github.com/eamonma/chatgpt-etl/blob/main/spec.md

The `GET /backend-api/conversation/{id}` response appears to contain a rich conversation object, including a message tree, alternative branches, metadata and the currently selected node.

Prefer retaining ChatGPT's native data structure, including fields and content types we don't yet understand, over inventing our own schema. I can post-process the data later.

Investigate whether ordinary browsing exposes sufficiently recent complete snapshots. In particular, understand what happens after generation, editing, regeneration, branching, renaming and asynchronous tasks. If complete snapshots aren't always available, find the simplest way of preserving the missing information through passive observation. Raw events that can be processed later may be preferable to fragile reconstruction logic now.

## Data integrity

Think of this as replicating mutable documents, not appending chat transcripts.

I want one readily accessible, up-to-date JSON object per conversation, identified by its stable conversation ID.

Newer information should supersede older information, but a stale, partial, interrupted or malformed capture should never silently destroy a good backup. Consider concurrent tabs, delayed responses, unreliable timestamps, legitimate deletions and changes to the active branch.

Retain previous distinct versions wherever useful for recovery. Disk space is relatively cheap; lost information is expensive. Avoid unnecessary duplicate writes.

More generally, preserve information when uncertain rather than guessing what it means.

## Constraints

- Entirely local. No external destinations, telemetry, servers, schedulers or native messaging.
- No additional ChatGPT requests, credential collection, authentication interception or bypassing access restrictions. Review applicable service terms before enabling capture.
- Explicit opt-in, limited to my authorized conversations.
- Reuse the extension's existing local directory access and storage infrastructure.
- Keep raw backups separate from the archives generated by `~/code/scripts/backupchatgpt.py` and the official data exports.
- No DOM scraping unless there is an exceptionally compelling reason.
- Prefer native browser APIs, minimal code, no dependencies and no build step.
- Capture failures must never interfere with normal ChatGPT usage.
- Keep the UI minimal. I primarily want to know whether backups are happening, whether they are stale, and whether anything requires my attention.

Read the existing repository, its AGENTS.md, the previous backup script, and relevant skills for context. But do not inherit complexity merely because it exists.

## Verification

Establish with evidence that the backup works for realistic usage, including:

- New conversations and follow-up messages.
- Edited prompts, regenerated answers and alternative branches.
- Branching into a new conversation.
- Long conversations and rich content.
- Concurrent tabs, repeated captures and out-of-order updates.
- Interrupted generation, browser restarts and unavailable local storage.

Compare representative saved conversations against their source objects and, where available, official ChatGPT export data.

Use synthetic fixtures for destructive and unusual cases. Don't modify meaningful existing conversations to test edge cases.

Distinguish observed complete snapshots from provisional or incomplete captures. Be explicit about coverage gaps, especially attachments, asynchronous tasks and conversations I have not reopened.

Implement and test the simplest design that meets the intent. Exercise judgment about implementation details. Document the design, what you discovered about ChatGPT's current behavior, verification results and remaining limitations.

Challenge any of my proposed approaches if you find a simpler or more reliable solution.
```

---

The unexpected may happen. Plan to save what you need for diagnostics and future analysis.

---

Some chats are long, e.g. https://chatgpt.com/c/6afb321d-4ca4-83ec-bced-f56b5f36e263 and are loaded on demand. If you haven't tested such, might be worth testing.

---

Projects, Images, Artifacts, ... there may be other issues to handle, and ~/Documents/chatgpt/conversations*.json might give you some inputs on what to handle.

---

That works. Now apply the same principles for claude.ai and backup the data. ~/Documents/claude/conversations.json might give you some inputs on what to handle.

--- <!-- /model gpt-6-luna /effort xhigh -->

Clean up and commit relevant files.

<!-- codex resume 01a1e9f2-41db-7333-b5e6-aea0e0abe802 -->

## Annotate websites with actions, 16 Nov 2026

<!--
cd ~/code/anand-chrome-tools
claude --model opus --effort medium
-->

I'd like to update this extension so that I can annotate sites where I perform work. The sites are:

- mail.google.com: I'll annotate emails in my inbox (or, perhaps any view) with what I need to do next.
- chatgpt.com: I'll annotate caht lists (e.g. in recents or under projects on the left sidebar, maybe search, etc.) with what I need to do next.
- calendar.google.com: I'll annotate calendar entries with what I need to prepare for the meeting.
- claude.com: Same as chatgpt.com

The annotations tell me what I need to do next, so they should be prominently visible against the item.
They're typically short, like "Schedule this on calendar" or "Download and recreate using an agent", but (e.g. for Calendar events) a few might be MUCH longer and multi-line. I would like #hashtags to be highlighted and, perhaps, limited Markdown (**bold** and _italics_) support.
I have multiple accounts on Google, ChatGPT, Claude, etc. so make sure you pick an ID for the items that'll be unique across accounts.
I'd like the annotations to be stored on the local file system at ~/Documents/data/anand-chrome-tools/actions.jsonl - or any other file format, keeping in mind that this might grow. Assuming I annotate 30 items a day x 365 / year, would the JSONL be OK for a few years or do I need a different format?
I might extend this to a few more sites in the future, so keep the design extensible and simple.
The sites might change their UI. So make sure the implementation is simple and robust. In the worst case, you might just append / prepend to a specific element's HTML (e.g. subject, thread title, etc.)

Each site will need a different UI approach. For example, I'd prefer these be always visible. My preference is below, but I'm OK for you to change based on your design preference as well as what's simple and robust:

- mail.google.com: add it before the subject.
- chatgpt.com: add it below the thread title.
- calendar.google.com: add an indicator in the event chip, and show full annotation when the event is clicked.
- claude.com: add it below the thread title.

Test out variations, evaluating pros and cons, before finalizing.

--- <!-- steering -->

I prefer calendar annotations to appear on all recurrances.

--- <!-- steering -->

The black-on-yellow design on ChatGPT is too loud and doesn't feel aligned with the item, e.g. I don't know if it's associated with the one above or below.
But the yellow outline on the calendar feels about right.

---

Treat clicking outside the dialog as a save, not cancel.
Highlight @tags - slightly differently from #hashtags.
On ChatGPT and Claude, the annotation overlaps with the rounded box that highlights the currently selected item and doesn't look good.
I take back what I said about calendar annotations. Annotations should be item specific, i.e. different annotations for each instance of a recurring event.

<!-- claude --model opus --effort medium --resume d481c9e2-e500-46e7-8bba-77a1ac03134a -->

## Anand Chrome Tools - Use Bookmarklet Title as Key, 08 Oct 2026

<!-- Anand Chrome Tools - Use Bookmarklet Title as Key: https://chatgpt.com/c/6ac73f5f-23e0-83ec-a314-a3f68954e4d5 (2026-10-08T15:14:30+08:00) -->

On @LocalMCP2 the plugin at ~/code/anand-chrome-tools/ maps bookmarklets based on their URLs, I think. (Is that right?)

But I might change the bookmarklet. For example, I just changed the ChatGPT scraper bookmarklet. The count fell to zero - though I've used it before. I used the new bookmarklet a few times.

I would prefer using the title of bookmarklets rather than the URL. (This is just for bookmarklets.)

Review the repo. What's the minimal change that'll achieve this? Use relevant skills.

---

Based on this, I would expect to see the old and new ChatGPT scraper bookmarklets both count towards the same usage count. Is that right?
If yes, proceed with the change.
If not, let me know what additional changes are required.

## Log to filesystem and add titles, 07 Oct 2026

<!-- 🔸commit Anand Chrome Tools - File system and Tab Titles: https://chatgpt.com/c/6ac58504-82f8-83ec-bd3c-4892ff71e236 (2026-10-07T10:26:16+08:00) -->

Can a Chrome/Edge browser extension like @LocalMCP2 ~/code/anand-chrome-tools/ get permission to be able to read, write, append to files in a local directory? I'd like to maintain a log of actions, etc. in a local directory. What would it take to do that? I mean, does the user give permissions upfront during installation or something else? How do users specific WHICH directory to allow access for and how can they change that? What's the easiest way to implement this in ~/code/anand-chrome-tools?

Treat these as sample use cases I'm solving for (though I'll likely add much more to the directory).

- Whenever the user performs an action, I will log it in actions.jsonl
- The user can annotate any website and I'll store that in notes.jsonl and it'll be visible when they open that page

For anything you're unsure of, feel free to test and verify. But when using agent-browser with CDP localhost:9222 try using background operations (see devtools skill) as much as possible, to avoid disturbing my browser, and avoid changing tabs you didn't open.

---

OK. Implement the settings page (elegant, lightweight & minimal) and action logs. I don't need action logs to be synced on every action - just once daily is sufficient. It might be good if the extension reads from the directory on load, saves once daily or on exit (if there are any new actions to save). In that sense, a monthly (UTC) JSONL is probably fine. The extension has to maintain new actions in memory (or local storage) and save them periodically. It also needs to maintain the action usage counts - probably in memory (or local storage).

Think about the simplest, most lightweight (resource-wise AND code-wise) implementation. Explore alternatives & test if you think them worthwhile, pick what emerges as the best approach, and document your rationale.

Run and test - or let me know what to do and I'll test it.

---

That worked. Commit to the repo (including the prompts.md I changed)

Now, I'd like to implement a "Title" command. If I type "Title: some text here" or "title: some text here" or even "title: prefix: more text", it should append to a file in the file system a note saying that as of this timestamp, I decided to prefix the title of this page with everything after the first colon (whitespace-trimmed). When I come back to that page, if the title doesn't already start with that prefix, it should automatically add it. This is useful for adding context to pages you revisit later.

Also implement a "Title clear" command that removes the prefix from the page (if it exists).

What file format approach would be best to implement this? Take a look at my open tabs history in ~/Documents/data/open-tabs/ - the unique set of URLs in these is probably the number of pages I would annotate over that time period - and it might grow, but unlikely to more than double. If this extension lasts 3 years, I'd be morethan happy, so no need to plan for beyond that.

This is the pattern for a broader set of command options. I want to be able to type "Command: some text here" or "command: some text here" and it should pass the text to the command handler. For now, the only command is "Title", but in the future, I want to be able to add more commands. The command handler should be able to parse the text and decide what to do with it.

What's the cleanest - easy to read, short code, minimal changes, minimal features, most robust - way to implement this?

---

I'd like "Title" and "Title clear" to appear as an explicit commands I can select. Selecting "Title" is the same as typing "Title: " in the search box. Similarly for "Title clear". That makes discovery easier. Also update docs - think about an end user reading the README.md for the first time and help them understand.

---

Yes, the new commands appear. But when I type "Title clear" or even start typing anything after "Title " the "Title clear" command vanishes. When I type "title clear" it does clear the title but it's not visible in the UI. Again, I want an elegant change - not something that just fixes this issue but the general approach.

---

When logging the title action in the actions-yyyy-mm.jsonl and internally, also log the URL and preserve it. Keep in mind that future actions may add other fields. I prefer flat over nested, but still, if you strongly think that for my own good it's better to nest at least one level, that's fine. Go ahead and implement.

---

It may make sense to log the URL for ALL commands, actually.

---

In the actions log, also log the title of the URL, apart from the URL. "title" as a keyword is probably fine here but feel free to change it if you think appropriate.

---

Add a 🔸at the start of each title when updating the tab title. That way, I'll know which tabs have a custom title. For example, if I say "title: hello" the tab should display "🔸hello" - but the action / log should just capture hello, not the 🔸 - which is purely a visual indicator.

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
