import React, { useState } from 'react';

interface GroupChipEditorProps {
  value: string[];
  availableGroups: string[];
  onChange: (groups: string[]) => void;
  label?: string;
  compact?: boolean;
}

export const GroupChipEditor: React.FC<GroupChipEditorProps> = ({
  value,
  availableGroups,
  onChange,
  label = 'Groups',
  compact = false,
}) => {
  const [newGroup, setNewGroup] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  const allGroups = [...new Set([...availableGroups, ...value])];

  const handleToggle = (group: string) => {
    const updated = value.includes(group)
      ? value.filter((g) => g !== group)
      : [...value, group];
    onChange(updated);
  };

  const handleAdd = () => {
    const group = newGroup.trim();
    if (group && !value.includes(group)) {
      onChange([...value, group]);
    }
    setNewGroup('');
    if (compact) {
      setShowAddInput(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newGroup.trim()) {
      e.preventDefault();
      handleAdd();
    }
    if (e.key === 'Escape' && compact) {
      e.preventDefault();
      setNewGroup('');
      setShowAddInput(false);
    }
  };

  if (compact) {
    return (
      <div className="ei-group-chips ei-group-chips--inline">
        {allGroups.map((group) => {
          const isActive = value.includes(group);
          return (
            <button
              key={group}
              type="button"
              className={`ei-group-chip ei-group-chip--toggle ${isActive ? 'ei-group-chip--active' : ''}`}
              onClick={() => handleToggle(group)}
            >
              <span className="ei-group-chip__check">{isActive ? '✓' : '○'}</span>
              {group}
            </button>
          );
        })}
        {showAddInput ? (
          <>
            <input
              type="text"
              className="ei-input ei-group-chips__add-input"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="New group…"
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              type="button"
              className="ei-btn ei-btn--secondary ei-group-chips__add-confirm"
              onClick={handleAdd}
              disabled={!newGroup.trim()}
            >
              Add
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ei-group-chip ei-group-chip--add"
            onClick={() => setShowAddInput(true)}
            title="Add group"
          >
            +
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ei-form-group">
      {label && <label className="ei-form-label">{label}</label>}
      <div className="ei-group-input-row">
        <input
          type="text"
          className="ei-input"
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          placeholder="Add new group"
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="ei-btn ei-btn--secondary"
          onClick={handleAdd}
          disabled={!newGroup.trim()}
        >
          Add
        </button>
      </div>
      <div className="ei-group-chips">
        {allGroups.map((group) => {
          const isActive = value.includes(group);
          return (
            <button
              key={group}
              type="button"
              className={`ei-group-chip ei-group-chip--toggle ${isActive ? 'ei-group-chip--active' : ''}`}
              onClick={() => handleToggle(group)}
            >
              <span className="ei-group-chip__check">{isActive ? '✓' : '○'}</span>
              {group}
            </button>
          );
        })}
      </div>
    </div>
  );
};
