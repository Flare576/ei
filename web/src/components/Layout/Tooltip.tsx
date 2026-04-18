import '../../styles/tooltip.css';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Tooltip({ text, children, disabled }: TooltipProps) {
  if (disabled || !text) {
    return <>{children}</>;
  }

  return (
    <div className="ei-tooltip">
      {children}
      <div className="ei-tooltip__bubble">{text}</div>
    </div>
  );
}
