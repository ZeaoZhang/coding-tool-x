# Autopilot Specification: Fix MCP Tool Height Inconsistency

## Product Idea

Fix the height inconsistency in the MCP tools list where the first tool appears to have different visual spacing than other tools. All tools should have consistent vertical spacing.

---

## Phase 0: Requirements Analysis

### Functional Requirements

1. **Fix visual spacing inconsistency**
   - First tool (web_search_exa) has different visual spacing
   - Other tools (company_research_exa, get_code_context_exa) have consistent spacing
   - All tools should have uniform vertical spacing

2. **Maintain collapsed state appearance**
   - Fix applies to collapsed tool headers
   - No changes to expanded content needed

### Non-Functional Requirements

1. **Visual Consistency**: All tool items should have identical spacing
2. **UX**: Clean, professional appearance with uniform gaps
3. **Maintainability**: Simple CSS fix, no complex logic

### Root Cause (from Exploration)

**File**: `src/web/src/components/McpServerDetailDrawer.vue`
**Line**: 359

```css
:deep(.n-collapse-item) {
  width: 100%;
  margin-bottom: 8px;  /* ← ISSUE: Creates gap after each item */
  border-radius: 8px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  overflow: hidden;
}
```

**Problem**:
- Each collapse item has `margin-bottom: 8px`
- First item has no `margin-top`, so it sits flush against the top
- Subsequent items have visual gap from previous item's `margin-bottom`
- This creates inconsistent visual spacing

**Visual Effect**:
```
┌─────────────────┐
│ Tool 1          │ ← No margin-top (appears different)
└─────────────────┘
     8px gap       ← margin-bottom from Tool 1
┌─────────────────┐
│ Tool 2          │
└─────────────────┘
     8px gap
┌─────────────────┐
│ Tool 3          │
└─────────────────┘
```

### Solution Options

**Option 1: Add margin-top to first item** (Recommended)
```css
:deep(.n-collapse-item:first-child) {
  margin-top: 8px;
}
```
- Pros: Minimal change, adds symmetry
- Cons: Adds extra space at top

**Option 2: Use gap on parent** (Cleanest)
```css
:deep(.n-collapse) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
:deep(.n-collapse-item) {
  margin-bottom: 0; /* Remove */
}
```
- Pros: Modern CSS, cleaner approach
- Cons: Requires checking if Naive UI's n-collapse supports flex

**Option 3: Symmetric vertical margins**
```css
:deep(.n-collapse-item) {
  margin: 8px 0;
}
```
- Pros: Simple, symmetric
- Cons: May create double margins (16px) between items

**Recommended**: Option 1 (add margin-top to first-child)

### Out of Scope

1. **Content height changes**: Not modifying tool card internal spacing
2. **Expanded state**: Only fixing collapsed header spacing
3. **Other drawers**: Only fixing McpServerDetailDrawer

---

## Phase 0: Technical Specification

### Architecture Overview

**Current State:**
- `McpServerDetailDrawer.vue` uses Naive UI's `n-collapse` component
- Custom CSS overrides at lines 357-377
- `margin-bottom: 8px` on all collapse items causes first-item inconsistency

**Target State:**
- Add `margin-top: 8px` to first collapse item
- All tools have consistent 8px vertical spacing

### Tech Stack

- **Frontend**: Vue 3, Naive UI (existing)
- **No new dependencies required**

### File to Modify

```
src/web/src/components/McpServerDetailDrawer.vue
```

### Implementation

**Location**: After line 365 (inside the `:deep(.n-collapse-item)` block or as new rule)

**Add**:
```css
:deep(.n-collapse-item:first-child) {
  margin-top: 8px;
}
```

### Acceptance Criteria

1. ✅ First tool has same visual spacing as other tools
2. ✅ All tools have consistent 8px gaps between them
3. ✅ No layout shift or overflow issues
4. ✅ Works in both collapsed and expanded states
5. ✅ No regression in other drawer components

---

## EXPANSION_COMPLETE

Specification ready for implementation.
