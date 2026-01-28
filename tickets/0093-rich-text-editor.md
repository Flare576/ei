# 0093: Rich Text Editor (Markdown + WYSIWYG)

**Status**: PENDING
**Depends on**: 0080

## Summary

Dual-mode editor for description fields: raw markdown and rich text.

## Acceptance Criteria

- [ ] Toggle between raw markdown and WYSIWYG modes
- [ ] WYSIWYG supports: bold, italic, underline, lists, links, code
- [ ] Emoji support (at minimum: doesn't break; ideally: picker)
- [ ] Sync between modes without data loss
- [ ] Use established OSS library (not custom)
- [ ] Consistent styling across all editor instances

## Notes

**V1 Backward Reference**:
- "Multi-line editor should have two modes: raw markdown and Rich-Text editor"
- "find the best, most-compatible open-source option and leverage it"
- "has to support emoji... at minimum doesn't break, ideally a widget to select"

Candidates: TipTap, Lexical, Slate, Milkdown. Research before committing.
