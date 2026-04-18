import '../../styles/tooltip.css';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  disabled?: boolean;
  align?: 'center' | 'left' | 'right';
}

export function Tooltip({ text, children, disabled, align = 'center' }: TooltipProps) {
  if (disabled || !text) {
    return <>{children}</>;
  }

  const bubbleClass = `ei-tooltip__bubble${align !== 'center' ? ` ei-tooltip__bubble--${align}` : ''}`;

  return (
    <div className="ei-tooltip">
      {children}
      <div className={bubbleClass}>{text}</div>
    </div>
  );
}
