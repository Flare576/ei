# 0052: Window Size CLI Parameter

**Status**: PENDING

## Summary
Add CLI parameters to force specific terminal dimensions, overriding automatic detection for testing and specialized use cases.

## Problem
Testing different layout behaviors requires manual terminal resizing. Some users may want to force specific dimensions that persist regardless of actual terminal size changes.

## Proposed Solution
Implement CLI parameters for forced window dimensions:

```bash
# Command line options
npm start -- --width 120 --height 40
npm start -- --size 120x40
npm start -- -w 120 -h 40
```

**Behavior:**
- Overrides blessed's automatic terminal size detection
- Forces layout system to use specified dimensions permanently
- Ignores actual terminal resize events during session
- Useful for testing responsive layouts at specific sizes
- Allows users to create consistent window experiences

## Acceptance Criteria
- [ ] `--width <number>` sets forced terminal width
- [ ] `--height <number>` sets forced terminal height  
- [ ] `--size <width>x<height>` sets both dimensions with single parameter
- [ ] Short flags `-w` and `-h` work as aliases
- [ ] Forced dimensions override blessed's terminal detection
- [ ] Layout system uses forced dimensions instead of actual terminal size
- [ ] Terminal resize events ignored when dimensions are forced
- [ ] Invalid dimensions show helpful error messages
- [ ] `--help` documents window size parameters
- [ ] Forced dimensions persist for entire session

## Value Statement
Enables consistent testing of layout behaviors and provides specialized window control for users with specific workflow needs.

## Dependencies
- Blessed terminal size detection system
- Layout management system

## Effort Estimate
Small (~1-2 hours)