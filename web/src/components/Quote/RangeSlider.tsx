import React from 'react';

interface RangeSelectorProps {
  min: number;
  max: number;
  startValue: number;
  endValue: number;
  onChange: (start: number, end: number) => void;
}

export function RangeSlider({
  min,
  max,
  startValue,
  endValue,
  onChange,
}: RangeSelectorProps) {
  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStart = Math.min(Number(e.target.value), endValue - 1);
    onChange(newStart, endValue);
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEnd = Math.max(Number(e.target.value), startValue + 1);
    onChange(startValue, newEnd);
  };

  return (
    <div className="ei-range-slider">
      <input
        type="range"
        className="ei-range-slider__start"
        min={min}
        max={max}
        value={startValue}
        onChange={handleStartChange}
      />
      <input
        type="range"
        className="ei-range-slider__end"
        min={min}
        max={max}
        value={endValue}
        onChange={handleEndChange}
      />
    </div>
  );
}
