# EntityEditor Components

React components for editing Human and Persona entities in the web UI.

## Structure

```
EntityEditor/
├── index.ts               # Exports
├── HumanEditor.tsx        # Human entity editing (620+ lines)
├── PersonaEditor.tsx      # Persona entity editing
├── PersonaCreatorModal.tsx # New persona wizard
├── ArchivedPersonasModal.tsx
├── TabContainer.tsx       # Shared tab layout
├── DataItemCard.tsx       # Generic card for facts/traits/etc
├── FactCard.tsx           # Fact-specific card
├── PersonCard.tsx         # Person-specific card
├── GroupedCardList.tsx    # Group items by persona_groups
├── SliderControl.tsx      # Exposure/sentiment sliders
└── tabs/                  # Tab content components
    ├── HumanSettingsTab.tsx
    ├── HumanFactsTab.tsx
    ├── HumanTraitsTab.tsx
    ├── HumanTopicsTab.tsx
    ├── HumanPeopleTab.tsx
    ├── HumanQuotesTab.tsx
    └── ...
```

## Key Components

### HumanEditor

Tabbed editor for the Human entity. Manages:
- Settings (name, model, time format)
- Facts, Traits, Topics, People (CRUD operations)
- Quotes (with QuoteManagementModal)
- Sync credentials

**State pattern**: Local state + callbacks to App.tsx for persistence.

### PersonaEditor

Similar to HumanEditor but for PersonaEntity:
- Core settings (name, model, description)
- Personality traits
- Topic engagement (PersonaTopics)

### PersonaCreatorModal

Multi-step wizard for creating new personas:
1. Basic info (name, relationship)
2. Personality hints
3. Generation (LLM creates full persona)

## Patterns

### Data Flow

```
App.tsx (state owner)
  ├── fetchHuman() / updateHuman()
  ├── fetchPersona() / updatePersona()
  └── EntityEditor components (receive data + callbacks)
```

### Card Components

All data items use a card pattern:
- `DataItemCard` - Generic (name, description, sentiment)
- `FactCard` - Adds validation_level badge
- `PersonCard` - Adds relationship field

### Grouped Display

`GroupedCardList` organizes items by `persona_groups`:
- Items with groups → shown under group headers
- Items without groups → "General" section

## Editing Notes

- **Large files**: HumanEditor.tsx (620+ lines) and PersonaCreatorModal.tsx (500+ lines) are complex
- **Type definitions**: Local interfaces duplicate core types—consider importing from `src/core/types.ts`
- **Validation**: Check `ValidationLevel` enum when modifying fact handling
