import { useCallback, useState } from "react";
import { useWorkStation } from "../../contexts/WorkStationContext";

export default function DevTools() {
  const { devClearAllConnections, devClearAllGroups, loadWorkstationData } =
    useWorkStation();
  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  const handleClearConnections = useCallback(async () => {
    if (!window.confirm("确定清除所有连线？")) return;
    setIsWorking(true);
    try {
      await devClearAllConnections();
    } catch {
      // error surfaced via context
    } finally {
      setIsWorking(false);
    }
  }, [devClearAllConnections]);

  const handleClearGroups = useCallback(async () => {
    if (!window.confirm("确定清除所有分组和连线？此操作不可撤销。")) return;
    setIsWorking(true);
    try {
      await devClearAllGroups();
    } catch {
      // error surfaced via context
    } finally {
      setIsWorking(false);
    }
  }, [devClearAllGroups]);

  const handleReload = useCallback(async () => {
    setIsWorking(true);
    try {
      await loadWorkstationData();
    } catch {
      // error surfaced via context
    } finally {
      setIsWorking(false);
    }
  }, [loadWorkstationData]);

  if (!isOpen) {
    return (
      <button
        className="devtools-fab"
        onClick={() => setIsOpen(true)}
        title="开发者工具"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="devtools-panel">
      <div className="devtools-header">
        <span>DevTools</span>
        <button className="devtools-close" onClick={() => setIsOpen(false)}>
          ×
        </button>
      </div>
      <div className="devtools-body">
        <button
          className="devtools-btn"
          onClick={handleClearConnections}
          disabled={isWorking}
        >
          清除所有连线
        </button>
        <button
          className="devtools-btn devtools-btn-danger"
          onClick={handleClearGroups}
          disabled={isWorking}
        >
          清除所有分组
        </button>
        <button
          className="devtools-btn"
          onClick={handleReload}
          disabled={isWorking}
        >
          重新加载
        </button>
      </div>
    </div>
  );
}
