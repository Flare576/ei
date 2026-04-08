import React, { useState } from 'react';

interface GroupChipEditorProps {
  value: string[];
  availableGroups: string[];
  onChange: (groups: string[]) => void;
  label?: string;
}

export const GroupChipEditor: React.FC<GroupChipEditorProps> = ({
  value,
  availableGroups,
  onChange,
  label = 'Groups',
}) => {
  const [newGroup, setNewGroup] = useState('');

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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newGroup.trim()) {
      e.preventDefault();
      handleAdd();
    }
  };

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
