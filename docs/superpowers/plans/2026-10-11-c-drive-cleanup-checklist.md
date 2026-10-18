# C 盘清理选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline HTML checklist that explains ambiguous C-drive cleanup candidates and exports the user's choices as JSON.

**Architecture:** One self-contained HTML file with embedded CSS, data, and vanilla JavaScript. Static item metadata drives rendering; local state only stores checkbox state during the page session, and export serializes the selected IDs plus metadata.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, Blob download API, Clipboard API with a fallback.

---

### Task 1: Create the offline checklist page

**Files:**
- Create: `E:/日语50音/c-drive-cleanup-checklist.html`

- [ ] **Step 1: Add the page shell and accessible controls**

  Add a page title, summary cards, group headings, labeled checkboxes, details toggles, a fixed selection bar, and live status text. Use no external assets or network imports.

- [ ] **Step 2: Add the reviewed disk items**

  Encode the previously inspected disk summary and item metadata. Put only ordinary re-downloadable temp/cache items in the direct-cleanup group; put software, SDKs, models, virtual devices, and user data in the decision group; put protected system/user-data locations in the keep group.

- [ ] **Step 3: Implement selection and export behavior**

  Render all groups from the data array. Update selected count and estimated space on every checkbox change. Implement group select/clear, JSON download named `c-drive-cleanup-selection.json`, and copy-to-clipboard with a visible status message.

### Task 2: Verify the artifact

**Files:**
- Verify: `E:/日语50音/c-drive-cleanup-checklist.html`

- [ ] **Step 1: Run static checks**

  Confirm the file exists, has no external `http`/`https` imports, and has balanced script/style tags.

- [ ] **Step 2: Exercise the JSON contract**

  Parse the embedded data and confirm every item has a unique ID, group, space value, purpose, impact, recovery, and path field; confirm no decision item starts selected.

- [ ] **Step 3: Inspect the final diff**

  Confirm only the new checklist and planning documents are added; do not alter the user's existing modified files.
