import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import {
  X,
  TerminalSquare,
  Loader2,
  PanelRight,
  PanelBottom,
  Plus,
  Minus,
  GripVertical,
  GripHorizontal
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

// Types
export type PanelPosition = 'right' | 'bottom';

interface TerminalTab {
  id: string;
  name: string;
  vmId: string;
  vmIp: string;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

interface TerminalPanelContextType {
  isOpen: boolean;
  position: PanelPosition;
  tabs: TerminalTab[];
  activeTabId: string | null;
  openTerminal: (vmId: string, vmName: string, vmIp: string) => void;
  closeTerminal: (tabId: string) => void;
  closePanel: () => void;
  setPosition: (position: PanelPosition) => void;
  setActiveTab: (tabId: string) => void;
}

const TerminalPanelContext = createContext<TerminalPanelContextType | null>(null);

export function useTerminalPanel() {
  const context = useContext(TerminalPanelContext);
  if (!context) {
    throw new Error('useTerminalPanel must be used within TerminalPanelProvider');
  }
  return context;
}

// Provider component
export function TerminalPanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>('bottom');
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const openTerminal = useCallback((vmId: string, vmName: string, vmIp: string) => {
    // Check if terminal for this VM already exists
    const existingTab = tabs.find(t => t.vmId === vmId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setIsOpen(true);
      return;
    }

    const newTab: TerminalTab = {
      id: `term-${vmId}-${Date.now()}`,
      name: vmName,
      vmId,
      vmIp,
      connectionState: 'connecting',
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setIsOpen(true);
  }, [tabs]);

  const closeTerminal = useCallback((tabId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (newTabs.length === 0) {
        setIsOpen(false);
        setActiveTabId(null);
      } else if (activeTabId === tabId) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updateTabState = useCallback((tabId: string, state: Partial<TerminalTab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...state } : t));
  }, []);

  return (
    <TerminalPanelContext.Provider value={{
      isOpen,
      position,
      tabs,
      activeTabId,
      openTerminal,
      closeTerminal,
      closePanel,
      setPosition,
      setActiveTab: setActiveTabId,
    }}>
      {children}
      {isOpen && (
        <TerminalPanelUI
          tabs={tabs}
          activeTabId={activeTabId}
          position={position}
          onTabClose={closeTerminal}
          onTabSelect={setActiveTabId}
          onClose={closePanel}
          onPositionChange={setPosition}
          onTabStateChange={updateTabState}
        />
      )}
    </TerminalPanelContext.Provider>
  );
}

// Terminal Panel UI
interface TerminalPanelUIProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  position: PanelPosition;
  onTabClose: (tabId: string) => void;
  onTabSelect: (tabId: string) => void;
  onClose: () => void;
  onPositionChange: (position: PanelPosition) => void;
  onTabStateChange: (tabId: string, state: Partial<TerminalTab>) => void;
}

function TerminalPanelUI({
  tabs,
  activeTabId,
  position,
  onTabClose,
  onTabSelect,
  onClose,
  onPositionChange,
  onTabStateChange,
}: TerminalPanelUIProps) {
  const [size, setSize] = useState(position === 'bottom' ? 350 : 500);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (position === 'bottom') {
        const newSize = window.innerHeight - e.clientY;
        setSize(Math.max(200, Math.min(newSize, window.innerHeight - 100)));
      } else {
        const newSize = window.innerWidth - e.clientX;
        setSize(Math.max(300, Math.min(newSize, window.innerWidth - 300)));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, position]);

  const panelClasses = position === 'bottom'
    ? 'fixed bottom-0 left-52 right-0 border-t'
    : 'fixed top-0 right-0 bottom-0 border-l';

  const resizeHandleClasses = position === 'bottom'
    ? 'absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-[hsl(var(--cyan)/0.3)] transition-colors flex items-center justify-center'
    : 'absolute top-0 left-0 bottom-0 w-1 cursor-ew-resize hover:bg-[hsl(var(--cyan)/0.3)] transition-colors flex items-center justify-center';

  return (
    <div
      ref={panelRef}
      className={`${panelClasses} z-40 flex flex-col bg-[hsl(var(--bg-base))] border-[hsl(var(--border))]`}
      style={position === 'bottom' ? { height: size } : { width: size }}
    >
      {/* Resize handle */}
      <div
        className={resizeHandleClasses}
        onMouseDown={handleMouseDown}
      >
        {position === 'bottom' ? (
          <GripHorizontal className="h-3 w-3 text-[hsl(var(--text-muted))] opacity-0 hover:opacity-100" />
        ) : (
          <GripVertical className="h-3 w-3 text-[hsl(var(--text-muted))] opacity-0 hover:opacity-100" />
        )}
      </div>

      {/* Header with tabs */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        {/* Tabs */}
        <div className="flex items-center overflow-x-auto flex-1 min-w-0">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-[hsl(var(--border))] whitespace-nowrap ${
                tab.id === activeTabId
                  ? 'bg-[hsl(var(--bg-base))] text-[hsl(var(--text-primary))]'
                  : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
              }`}
              onClick={() => onTabSelect(tab.id)}
            >
              <TerminalSquare className={`h-3.5 w-3.5 ${
                tab.connectionState === 'connected' ? 'text-[hsl(var(--green))]' :
                tab.connectionState === 'connecting' ? 'text-[hsl(var(--amber))]' :
                'text-[hsl(var(--red))]'
              }`} />
              <span className="max-w-[120px] truncate">{tab.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[hsl(var(--bg-overlay))] rounded"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 px-2">
          <button
            onClick={() => onPositionChange(position === 'bottom' ? 'right' : 'bottom')}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            title={position === 'bottom' ? 'Move to right' : 'Move to bottom'}
          >
            {position === 'bottom' ? (
              <PanelRight className="h-3.5 w-3.5" />
            ) : (
              <PanelBottom className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setSize(s => Math.min(s + 100, position === 'bottom' ? 600 : 800))}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            title="Expand"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setSize(s => Math.max(s - 100, position === 'bottom' ? 200 : 300))}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            title="Shrink"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
            title="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${tab.id === activeTabId ? 'block' : 'hidden'}`}
          >
            <TerminalInstance
              tab={tab}
              onStateChange={(state) => onTabStateChange(tab.id, state)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Individual terminal instance
interface TerminalInstanceProps {
  tab: TerminalTab;
  onStateChange: (state: Partial<TerminalTab>) => void;
}

function TerminalInstance({ tab, onStateChange }: TerminalInstanceProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isDisposedRef = useRef(false);

  const getWsUrl = useCallback(() => {
    const apiPort = (window as unknown as { __API_PORT__?: number }).__API_PORT__ || 4001;
    // Use same hostname as current page for remote access support
    const hostname = window.location.hostname || 'localhost';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${hostname}:${apiPort}/ws/terminal`;
  }, []);

  // Stable callback ref to avoid re-running effect
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    if (!terminalRef.current) return;

    isDisposedRef.current = false;

    // Create terminal instance with theme matching the UI
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: 'hsl(220 20% 6%)',
        foreground: 'hsl(220 10% 85%)',
        cursor: 'hsl(190 90% 60%)',
        cursorAccent: 'hsl(220 20% 6%)',
        selectionBackground: 'hsl(190 90% 60% / 0.3)',
        selectionForeground: '#ffffff',
        black: 'hsl(220 20% 10%)',
        red: 'hsl(0 70% 65%)',
        green: 'hsl(140 60% 55%)',
        yellow: 'hsl(40 80% 55%)',
        blue: 'hsl(210 80% 65%)',
        magenta: 'hsl(280 60% 70%)',
        cyan: 'hsl(180 60% 55%)',
        white: 'hsl(220 10% 85%)',
        brightBlack: 'hsl(220 15% 35%)',
        brightRed: 'hsl(0 80% 70%)',
        brightGreen: 'hsl(140 70% 65%)',
        brightYellow: 'hsl(40 90% 65%)',
        brightBlue: 'hsl(210 90% 75%)',
        brightMagenta: 'hsl(280 70% 80%)',
        brightCyan: 'hsl(180 70% 65%)',
        brightWhite: 'hsl(220 5% 95%)',
      },
      allowProposedApi: true,
    });

    // Add fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Add web links addon
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    // Open terminal
    term.open(terminalRef.current);
    xtermRef.current = term;

    // Initial fit - delay to ensure container is sized
    const fitTimeout = setTimeout(() => {
      if (!isDisposedRef.current) {
        try {
          fitAddon.fit();
        } catch (e) {
          console.warn('[Terminal] Initial fit failed:', e);
        }
      }
    }, 100);

    // Connect WebSocket
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (isDisposedRef.current) return;
      // Send start-vm message for VM terminals
      ws.send(JSON.stringify({
        type: 'start-vm',
        vmId: tab.vmId,
        vmIp: tab.vmIp,
        shell: '/bin/bash',
        cols: term.cols,
        rows: term.rows,
      }));
    };

    ws.onmessage = (event) => {
      if (isDisposedRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'connected':
            onStateChangeRef.current({ connectionState: 'connected' });
            term.focus();
            break;
          case 'output':
            term.write(msg.data);
            break;
          case 'exit':
            onStateChangeRef.current({ connectionState: 'disconnected' });
            term.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
            break;
          case 'error':
            onStateChangeRef.current({ connectionState: 'error', errorMessage: msg.message });
            term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
            break;
        }
      } catch {
        // Handle non-JSON messages
      }
    };

    ws.onclose = () => {
      if (isDisposedRef.current) return;
      onStateChangeRef.current({ connectionState: 'disconnected' });
    };

    ws.onerror = () => {
      if (isDisposedRef.current) return;
      onStateChangeRef.current({ connectionState: 'error', errorMessage: 'Connection failed' });
    };

    // Handle terminal input
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize with debounce
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (isDisposedRef.current) return;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (isDisposedRef.current) return;
        try {
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            }));
          }
        } catch (e) {
          console.warn('[Terminal] Resize failed:', e);
        }
      }, 50);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      isDisposedRef.current = true;
      clearTimeout(fitTimeout);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [tab.vmId, tab.vmIp, getWsUrl]);

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(var(--bg-surface))] border-b border-[hsl(var(--border))] text-[10px]">
        <span className={`flex items-center gap-1.5 ${
          tab.connectionState === 'connected' ? 'text-[hsl(var(--green))]' :
          tab.connectionState === 'connecting' ? 'text-[hsl(var(--amber))]' :
          'text-[hsl(var(--red))]'
        }`}>
          {tab.connectionState === 'connecting' && <Loader2 className="h-3 w-3 animate-spin" />}
          <span className="uppercase tracking-wider">{tab.connectionState}</span>
        </span>
        <span className="text-[hsl(var(--text-muted))]">|</span>
        <span className="text-[hsl(var(--text-secondary))]">agent@{tab.vmIp}</span>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 p-1"
        style={{ backgroundColor: 'hsl(220 20% 6%)' }}
      />

      {/* Error overlay */}
      {tab.connectionState === 'error' && tab.errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--red)/0.3)] max-w-sm text-center">
            <p className="text-xs text-[hsl(var(--red))] mb-2">{tab.errorMessage}</p>
            <p className="text-[10px] text-[hsl(var(--text-muted))]">
              Make sure the VM is running and SSH is available
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
