import React from 'react';

interface SliderControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

const defaultFormat = (v: number) => v.toFixed(2);

export const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  formatValue = defaultFormat,
  disabled = false,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  return (
    <div className="ei-slider-control">
      <div className="ei-slider-control__header">
        <span className="ei-slider-control__label">{label}</span>
        <span className="ei-slider-control__value">{formatValue(value)}</span>
      </div>
      <input
        type="range"
        className="ei-slider-control__input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  );
};
