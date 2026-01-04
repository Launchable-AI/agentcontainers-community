import { useState, useEffect, useRef, useCallback } from 'react';
import { X, RefreshCw, Trash2, Pause, Play, Download } from 'lucide-react';
import * as api from '../api/client';

interface LogViewerProps {
  containerId?: string;
  composeName?: string;
  vmId?: string;
  buildId?: string;
  title: string;
  onClose: () => void;
}

export function LogViewer({ containerId, composeName, vmId, buildId, title, onClose }: LogViewerProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<'building' | 'completed' | 'failed' | null>(null);
  const [isStreaming, setIsStreaming] = useState(!vmId); // VMs don't support streaming
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  // Load initial logs and start streaming
  useEffect(() => {
    let mounted = true;

    const loadLogs = async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (buildId) {
          // Build logs - poll for updates while building
          const fetchBuildLogs = async () => {
            try {
              const result = await api.getBuildLogs(buildId);
              if (mounted) {
                setLogs(result.logs);
                setBuildStatus(result.status);
                // Stop polling if build is complete or failed
                if (result.status !== 'building' && pollIntervalRef.current) {
                  clearInterval(pollIntervalRef.current);
                  pollIntervalRef.current = null;
                }
              }
            } catch (err) {
              if (mounted) {
                setError(err instanceof Error ? err.message : 'Failed to load build logs');
              }
            }
          };

          await fetchBuildLogs();

          // Poll for new logs every second while building
          if (isStreaming) {
            pollIntervalRef.current = setInterval(fetchBuildLogs, 1000);
            cleanupRef.current = () => {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
              }
            };
          }
        } else if (vmId) {
          // VM logs - fetch boot/console logs (no streaming, but we can poll)
          const fetchVmLogs = async () => {
            try {
              const result = await api.getVmLogs(vmId, 1000);
              if (mounted && result.logs) {
                setLogs(result.logs.split('\n').filter(Boolean));
              }
            } catch (err) {
              if (mounted) {
                setError(err instanceof Error ? err.message : 'Failed to load VM logs');
              }
            }
          };

          await fetchVmLogs();

          // Poll for new logs every 2 seconds if streaming is enabled
          if (isStreaming) {
            pollIntervalRef.current = setInterval(fetchVmLogs, 2000);
            cleanupRef.current = () => {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
              }
            };
          }
        } else if (containerId) {
          // Fetch initial logs
          const initialLogs = await api.getContainerLogs(containerId, 500);
          if (!mounted) return;

          if (initialLogs) {
            setLogs(initialLogs.split('\n').filter(Boolean));
          }

          // Start streaming if enabled
          if (isStreaming) {
            cleanupRef.current = await api.streamContainerLogs(
              containerId,
              {
                onLog: (line) => {
                  if (mounted) {
                    setLogs((prev) => [...prev.slice(-2000), line]); // Keep last 2000 lines
                  }
                },
                onError: (err) => {
                  if (mounted) {
                    setLogs((prev) => [...prev, `[Stream Error: ${err}]`]);
                  }
                },
                onDone: () => {
                  if (mounted) {
                    setLogs((prev) => [...prev, '[Stream ended]']);
                  }
                },
              },
              0 // Don't fetch tail again, we already have initial logs
            );
          }
        } else if (composeName) {
          // For compose, use the existing compose logs API
          const apiBase = await api.getApiBase();
          const response = await fetch(`${apiBase}/composes/${composeName}/logs?tail=500`);

          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          const read = async () => {
            while (mounted) {
              const { done, value } = await reader.read();
              if (done) {
                setLogs((prev) => [...prev, '[Stream ended]']);
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.line) {
                      setLogs((prev) => [...prev.slice(-2000), data.line]);
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
            }
          };

          read().catch((err) => {
            if (mounted && err.name !== 'AbortError') {
              setError(err.message);
            }
          });

          cleanupRef.current = () => {
            reader.cancel().catch(() => {});
          };
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load logs');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadLogs();

    return () => {
      mounted = false;
      cleanupRef.current?.();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [containerId, composeName, vmId, buildId, isStreaming]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const handleRefresh = async () => {
    cleanupRef.current?.();
    setLogs([]);
    setIsStreaming(true);
  };

  const handleClear = () => {
    setLogs([]);
  };

  const handleToggleStreaming = () => {
    if (isStreaming) {
      cleanupRef.current?.();
      cleanupRef.current = null;
    }
    setIsStreaming(!isStreaming);
  };

  const handleDownload = () => {
    const content = logs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_')}_logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              {buildId ? 'Build Logs' : 'Logs'}: {title}
            </h2>
            {buildStatus === 'building' && (
              <span className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--cyan))]">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--cyan))] animate-pulse" />
                Building
              </span>
            )}
            {buildStatus === 'completed' && (
              <span className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--green))]">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--green))]" />
                Completed
              </span>
            )}
            {buildStatus === 'failed' && (
              <span className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--red))]">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--red))]" />
                Failed
              </span>
            )}
            {!buildId && isStreaming && (
              <span className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--green))]">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--green))] animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggleStreaming}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title={isStreaming ? 'Pause streaming' : 'Resume streaming'}
            >
              {isStreaming ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              onClick={handleRefresh}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title="Refresh logs"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={handleDownload}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title="Download logs"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={handleClear}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title="Clear logs"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-4 py-2 bg-[hsl(var(--red)/0.1)] border-b border-[hsl(var(--red)/0.3)] text-xs text-[hsl(var(--red))]">
            Error: {error}
          </div>
        )}

        {/* Logs Content */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-[hsl(var(--bg-base))] p-3 font-mono text-[11px] leading-relaxed"
        >
          {isLoading && logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[hsl(var(--text-muted))]">
              Loading logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[hsl(var(--text-muted))]">
              No logs available
            </div>
          ) : (
            <>
              {logs.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-all ${
                    line.includes('error') || line.includes('Error') || line.includes('ERROR')
                      ? 'text-[hsl(var(--red))]'
                      : line.includes('warn') || line.includes('Warn') || line.includes('WARN')
                      ? 'text-[hsl(var(--amber))]'
                      : line.startsWith('[')
                      ? 'text-[hsl(var(--text-muted))]'
                      : 'text-[hsl(var(--text-secondary))]'
                  }`}
                >
                  {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <div className="flex items-center justify-between text-[10px] text-[hsl(var(--text-muted))]">
            <span>{logs.length} lines</span>
            <span>Scroll down for newest logs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
