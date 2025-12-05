import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { X, Maximize2, Minimize2, TerminalSquare, Loader2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function Terminal({ containerId, containerName, onClose }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [isMaximized, setIsMaximized] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getWsUrl = useCallback(() => {
    // Get the API URL from the same origin or port file
    const apiPort = (window as unknown as { __API_PORT__?: number }).__API_PORT__ || 4001;
    return `ws://localhost:${apiPort}/ws/terminal`;
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        selectionForeground: '#ffffff',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#76e3ea',
        white: '#e6edf3',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#a5d6a7',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#a5f3fc',
        brightWhite: '#ffffff',
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

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    // Connect WebSocket
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Send start message
      ws.send(JSON.stringify({
        type: 'start',
        containerId,
        shell: '/bin/bash',
        cols: term.cols,
        rows: term.rows,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'connected':
            setConnectionState('connected');
            term.focus();
            break;
          case 'output':
            term.write(msg.data);
            break;
          case 'exit':
            setConnectionState('disconnected');
            term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
            break;
          case 'error':
            setConnectionState('error');
            setErrorMessage(msg.message);
            term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
            break;
        }
      } catch {
        // Handle non-JSON messages
      }
    };

    ws.onclose = () => {
      setConnectionState('disconnected');
    };

    ws.onerror = () => {
      setConnectionState('error');
      setErrorMessage('WebSocket connection failed');
    };

    // Handle terminal input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }));
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [containerId, getWsUrl]);

  // Handle maximize toggle resize
  useEffect(() => {
    if (fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          }));
        }
      }, 100);
    }
  }, [isMaximized]);

  const handleClose = () => {
    wsRef.current?.close();
    onClose();
  };

  return (
    <div
      className={`fixed z-50 flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl ${
        isMaximized
          ? 'inset-4'
          : 'bottom-4 right-4 w-[700px] h-[450px]'
      }`}
      style={{ transition: 'all 0.2s ease' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-[hsl(var(--cyan))]" />
          <span className="text-xs font-medium text-[hsl(var(--text-primary))]">
            {containerName}
          </span>
          <span className={`text-[10px] uppercase tracking-wider ${
            connectionState === 'connected'
              ? 'text-[hsl(var(--green))]'
              : connectionState === 'connecting'
              ? 'text-[hsl(var(--amber))]'
              : 'text-[hsl(var(--red))]'
          }`}>
            {connectionState === 'connecting' && (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Connecting
              </span>
            )}
            {connectionState === 'connected' && 'Connected'}
            {connectionState === 'disconnected' && 'Disconnected'}
            {connectionState === 'error' && 'Error'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 p-2"
        style={{ backgroundColor: '#0d1117' }}
      />

      {/* Error overlay */}
      {connectionState === 'error' && errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--red)/0.3)] max-w-sm">
            <p className="text-xs text-[hsl(var(--red))] mb-3">{errorMessage}</p>
            <button
              onClick={handleClose}
              className="w-full px-3 py-1.5 text-xs bg-[hsl(var(--red))] text-white hover:bg-[hsl(var(--red)/0.9)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
