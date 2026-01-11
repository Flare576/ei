# Requirements Document

## Introduction

Migrate the EI terminal user interface from Ink to Blessed framework to resolve fundamental layout, scrolling, and text rendering issues while maintaining all existing functionality.

## Glossary

- **EI_App**: The main Blessed-based application class in the prototype
- **Ink_Components**: The existing React/Ink-based UI components in src/components/
- **Focus_Management**: System for handling keyboard input focus between UI elements
- **Thinking_Indicators**: Visual feedback showing when personas are processing messages
- **Responsive_Layout**: UI that adapts to different terminal window sizes

## Requirements

### Requirement 1: Core Functionality Preservation

**User Story:** As a user, I want all existing EI functionality to work identically after the Blessed migration, so that my workflow is not disrupted.

#### Acceptance Criteria

1. WHEN I switch personas using `/persona <name>`, THE System SHALL change the active persona and update the UI
2. WHEN I send messages to personas, THE System SHALL process them and display responses
3. WHEN personas are processing in the background, THE System SHALL continue accepting input and switching personas
4. WHEN unread messages exist, THE System SHALL display accurate unread counts in the persona list
5. WHEN heartbeat timers trigger, THE System SHALL update persona status independently for each persona

### Requirement 2: Focus Management Resolution

**User Story:** As a user, I want reliable keyboard input handling, so that I can interact with the interface without losing focus or requiring manual refocus commands.

#### Acceptance Criteria

1. WHEN I send a regular message, THE Input_Box SHALL maintain focus for the next input
2. WHEN I send a command, THE Input_Box SHALL maintain focus for the next input  
3. WHEN I resize the terminal window, THE Input_Box SHALL preserve input state and maintain focus
4. IF focus is lost, THE System SHALL restore focus to the Input_Box while preserving future navigation capabilities
5. WHEN the interface updates, THE Input_Box SHALL remain responsive to keyboard input

### Requirement 3: Scrolling Implementation

**User Story:** As a user, I want to scroll through chat history using PageUp/PageDown keys, so that I can review previous conversations.

#### Acceptance Criteria

1. WHEN I press PageUp, THE Chat_History SHALL scroll up by 5 lines
2. WHEN I press PageDown, THE Chat_History SHALL scroll down by 5 lines
3. WHEN I reach the top of history, THE System SHALL prevent further upward scrolling
4. WHEN I reach the bottom of history, THE System SHALL prevent further downward scrolling
5. WHEN new messages arrive, THE Chat_History SHALL auto-scroll to show the latest message

### Requirement 4: Persona List Thinking Indicators

**User Story:** As a user, I want to see when personas are thinking or processing in the persona list, so that I understand which personas are actively working on responses.

#### Acceptance Criteria

1. WHEN a persona is processing a message, THE Persona_List SHALL display a thinking indicator for that specific persona
2. WHEN a persona completes processing, THE System SHALL remove the thinking indicator from the persona list
3. WHEN multiple personas are processing simultaneously, THE System SHALL show individual thinking indicators for each active persona in the persona list
4. WHEN displaying thinking indicators in the persona list, THE System SHALL maintain readable formatting and persona identification
5. WHEN personas have both unread messages and thinking indicators, THE System SHALL display both status types clearly in the persona list

### Requirement 5: Responsive Layout Maintenance

**User Story:** As a user, I want the interface to adapt to different terminal sizes, so that I can use EI in various environments.

#### Acceptance Criteria

1. WHEN terminal width is 100+ columns, THE System SHALL display the full three-pane layout
2. WHEN terminal width is 60-99 columns, THE System SHALL display the medium layout
3. WHEN terminal width is less than 60 columns, THE System SHALL display the compact layout
4. WHEN I resize the terminal, THE System SHALL immediately update the layout without corruption
5. WHEN layout changes occur, THE System SHALL preserve all UI state and functionality

### Requirement 6: Migration and Cleanup

**User Story:** As a developer, I want the Blessed implementation to replace the Ink implementation cleanly, so that the codebase is maintainable.

#### Acceptance Criteria

1. WHEN the Blessed implementation is complete, THE System SHALL use it as the main entry point
2. WHEN Ink components are no longer needed, THE System SHALL remove Ink dependencies from package.json
3. WHEN migration is complete, THE System SHALL preserve all existing business logic without modification
4. WHEN cleaning up, THE System SHALL maintain compatibility with existing data files and storage
5. WHEN the migration is done, THE System SHALL have simpler and more maintainable UI code than the Ink version