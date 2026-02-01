import { useState } from 'react';

interface DataItem {
  id: string;
  name: string;
  type: string;
}

interface DualListPickerProps {
  available: DataItem[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function DualListPicker({ available, selected, onChange }: DualListPickerProps) {
  const [leftSelected, setLeftSelected] = useState<string[]>([]);
  const [rightSelected, setRightSelected] = useState<string[]>([]);

  const availableItems = available.filter(item => !selected.includes(item.id));
  const selectedItems = available.filter(item => selected.includes(item.id));

  const handleMoveRight = () => {
    if (leftSelected.length === 0) return;
    onChange([...selected, ...leftSelected]);
    setLeftSelected([]);
  };

  const handleMoveLeft = () => {
    if (rightSelected.length === 0) return;
    onChange(selected.filter(id => !rightSelected.includes(id)));
    setRightSelected([]);
  };

  const toggleLeftSelect = (id: string) => {
    setLeftSelected(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleRightSelect = (id: string) => {
    setRightSelected(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="ei-dual-list-picker">
      <div className="ei-dual-list-picker__list">
        <div className="ei-dual-list-picker__header">Available</div>
        <div className="ei-dual-list-picker__items">
          {availableItems.length === 0 ? (
            <div className="ei-dual-list-picker__empty">No items</div>
          ) : (
            availableItems.map(item => (
              <div
                key={item.id}
                className={`ei-dual-list-picker__item ${leftSelected.includes(item.id) ? 'ei-dual-list-picker__item--selected' : ''}`}
                onClick={() => toggleLeftSelect(item.id)}
              >
                <span className="ei-dual-list-picker__item-name">{item.name}</span>
                <span className="ei-dual-list-picker__item-type">{item.type}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="ei-dual-list-picker__controls">
        <button
          type="button"
          className="ei-dual-list-picker__btn"
          onClick={handleMoveRight}
          disabled={leftSelected.length === 0}
          title="Add selected"
        >
          →
        </button>
        <button
          type="button"
          className="ei-dual-list-picker__btn"
          onClick={handleMoveLeft}
          disabled={rightSelected.length === 0}
          title="Remove selected"
        >
          ←
        </button>
      </div>

      <div className="ei-dual-list-picker__list">
        <div className="ei-dual-list-picker__header">Linked</div>
        <div className="ei-dual-list-picker__items">
          {selectedItems.length === 0 ? (
            <div className="ei-dual-list-picker__empty">None linked</div>
          ) : (
            selectedItems.map(item => (
              <div
                key={item.id}
                className={`ei-dual-list-picker__item ${rightSelected.includes(item.id) ? 'ei-dual-list-picker__item--selected' : ''}`}
                onClick={() => toggleRightSelect(item.id)}
              >
                <span className="ei-dual-list-picker__item-name">{item.name}</span>
                <span className="ei-dual-list-picker__item-type">{item.type}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
