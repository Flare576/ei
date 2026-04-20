import { DataSearchModal } from './DataSearchModal';

interface DataItem {
  id: string;
  name: string;
  type: 'Person' | 'Topic';
}

export interface TargetedCaptureModalProps {
  isOpen: boolean;
  items: DataItem[];
  onCapture: (item: DataItem) => void;
  onCaptureAll: () => void;
  onClose: () => void;
}

export function TargetedCaptureModal({
  isOpen,
  items,
  onCapture,
  onCaptureAll,
  onClose,
}: TargetedCaptureModalProps) {
  const handleSelect = (item: DataItem) => {
    onCapture(item);
  };

  const handleScanAll = () => {
    onCaptureAll();
    onClose();
  };

  return (
    <DataSearchModal
      isOpen={isOpen}
      title="Targeted Re-scan"
      placeholder="Search people and topics..."
      items={items}
      onSelect={handleSelect}
      onClose={onClose}
      footerHint="Select to re-scan · or scan everything below"
      footerContent={
        <button className="ei-data-search-modal__scan-all" onClick={handleScanAll}>
          Scan everything
        </button>
      }
    />
  );
}
