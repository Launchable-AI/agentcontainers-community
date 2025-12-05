import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  Package,
  ExternalLink,
  ChevronRight,
  X,
  Terminal,
  Wrench,
  MessageSquare,
  FileText,
} from 'lucide-react';
import * as api from '../api/client';
import type { MCPServer } from '../api/client';

export function MCPRegistry() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ lastSynced: string | null; count: number } | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load registry status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  // Search when debounced query changes
  useEffect(() => {
    if (syncStatus && syncStatus.count > 0) {
      searchServers(debouncedQuery);
    }
  }, [debouncedQuery, syncStatus]);

  const loadStatus = async () => {
    try {
      const status = await api.getMCPRegistryStatus();
      setSyncStatus(status);
      if (status.count > 0) {
        searchServers('');
      }
    } catch (err) {
      console.error('Failed to load MCP registry status:', err);
    }
  };

  const searchServers = async (query: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.searchMCPServers(query, 100);
      setServers(result.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
    setIsLoading(false);
  };

  const selectServer = async (server: MCPServer) => {
    setIsLoadingDetails(true);
    try {
      // Fetch full server details including install command
      const fullServer = await api.getMCPServer(server.name);
      setSelectedServer(fullServer);
    } catch (err) {
      // Fall back to the search result if fetching details fails
      setSelectedServer(server);
    }
    setIsLoadingDetails(false);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      await api.syncMCPRegistry(
        (message) => console.log('Sync progress:', message),
        (result) => {
          setSyncStatus({ lastSynced: result.timestamp, count: result.count });
          searchServers(debouncedQuery);
        },
        (error) => setError(error)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
    setIsSyncing(false);
  };

  const handleCopyCommand = useCallback(async (command: string, serverName: string) => {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(serverName);
    setTimeout(() => setCopiedCommand(null), 2000);
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getPackageIcon = (registryType: string) => {
    switch (registryType) {
      case 'npm': return 'npm';
      case 'pypi': return 'py';
      case 'docker': return 'docker';
      case 'crate': return 'rs';
      default: return registryType.slice(0, 2);
    }
  };

  // No servers synced yet
  if (!syncStatus || syncStatus.count === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-sm">
          <Package className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--text-muted))] opacity-30" />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] mb-2">
            MCP Server Registry
          </h3>
          <p className="text-xs text-[hsl(var(--text-muted))] mb-4">
            Sync the registry to browse and install MCP servers for Claude Code.
          </p>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50"
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isSyncing ? 'Syncing...' : 'Sync Registry'}
          </button>
          {error && (
            <p className="mt-3 text-xs text-[hsl(var(--red))]">{error}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Server List */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-[hsl(var(--border))]">
        {/* Search & Sync Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search MCP servers..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] focus:border-[hsl(var(--cyan))] focus:outline-none placeholder:text-[hsl(var(--text-muted))]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50"
            title="Sync Registry"
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
            {servers.length} {searchQuery ? 'results' : 'servers'}
          </span>
          {syncStatus?.lastSynced && (
            <span className="text-[10px] text-[hsl(var(--text-muted))]">
              Synced {formatDate(syncStatus.lastSynced)}
            </span>
          )}
        </div>

        {/* Server List */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
            </div>
          ) : servers.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-[hsl(var(--text-muted))]">
              No servers found
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {servers.map((server) => (
                <button
                  key={server.name}
                  onClick={() => selectServer(server)}
                  className={`w-full text-left p-3 hover:bg-[hsl(var(--bg-elevated))] transition-colors ${
                    selectedServer?.name === server.name ? 'bg-[hsl(var(--bg-elevated))]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
                          {server.title || server.name}
                        </span>
                        {server.status === 'deprecated' && (
                          <span className="px-1 py-0.5 text-[8px] uppercase tracking-wider bg-[hsl(var(--amber)/0.2)] text-[hsl(var(--amber))]">
                            Deprecated
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[hsl(var(--text-muted))] truncate mt-0.5">
                        {server.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        {server.packages.slice(0, 2).map((pkg, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-[hsl(var(--bg-base))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]"
                          >
                            {getPackageIcon(pkg.registryType)}
                          </span>
                        ))}
                        <span className="text-[9px] text-[hsl(var(--text-muted))]">
                          v{server.version}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[hsl(var(--text-muted))] flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Server Detail Panel */}
      <div className="w-96 flex flex-col bg-[hsl(var(--bg-surface))]">
        {isLoadingDetails ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
          </div>
        ) : selectedServer ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-[hsl(var(--border))]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                    {selectedServer.title || selectedServer.name}
                  </h3>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] font-mono mt-0.5">
                    {selectedServer.name}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedServer(null)}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedServer.status === 'deprecated' && (
                <div className="mt-2 px-2 py-1.5 text-[10px] bg-[hsl(var(--amber)/0.1)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.3)]">
                  This server is deprecated and may not be maintained.
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Description */}
              <div>
                <p className="text-xs text-[hsl(var(--text-secondary))] leading-relaxed">
                  {selectedServer.description}
                </p>
              </div>

              {/* Install Command */}
              {selectedServer.installCommand && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <Terminal className="h-3 w-3" />
                    <span>Install Command</span>
                  </div>
                  <div className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[10px] text-[hsl(var(--cyan))] font-mono break-all">
                        {selectedServer.installCommand}
                      </code>
                      <button
                        onClick={() => handleCopyCommand(selectedServer.installCommand!, selectedServer.name)}
                        className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors flex-shrink-0"
                        title="Copy command"
                      >
                        {copiedCommand === selectedServer.name ? (
                          <Check className="h-3.5 w-3.5 text-[hsl(var(--green))]" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Packages */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                  <Package className="h-3 w-3" />
                  <span>Packages</span>
                </div>
                <div className="space-y-1">
                  {selectedServer.packages.map((pkg, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 text-[9px] uppercase bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))]">
                          {pkg.registryType}
                        </span>
                        <span className="text-[10px] text-[hsl(var(--text-primary))] font-mono">
                          {pkg.identifier}
                        </span>
                      </div>
                      <span className="text-[9px] text-[hsl(var(--text-muted))]">
                        {pkg.version}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tools */}
              {selectedServer.tools && selectedServer.tools.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <Wrench className="h-3 w-3" />
                    <span>Tools ({selectedServer.tools.length})</span>
                  </div>
                  <div className="space-y-1">
                    {selectedServer.tools.slice(0, 5).map((tool, i) => (
                      <div key={i} className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
                        <span className="text-[10px] text-[hsl(var(--text-primary))] font-medium">
                          {tool.name}
                        </span>
                        {tool.description && (
                          <p className="text-[9px] text-[hsl(var(--text-muted))] mt-0.5 truncate">
                            {tool.description}
                          </p>
                        )}
                      </div>
                    ))}
                    {selectedServer.tools.length > 5 && (
                      <p className="text-[9px] text-[hsl(var(--text-muted))] px-2">
                        +{selectedServer.tools.length - 5} more tools
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Prompts */}
              {selectedServer.prompts && selectedServer.prompts.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <MessageSquare className="h-3 w-3" />
                    <span>Prompts ({selectedServer.prompts.length})</span>
                  </div>
                  <div className="space-y-1">
                    {selectedServer.prompts.slice(0, 3).map((prompt, i) => (
                      <div key={i} className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
                        <span className="text-[10px] text-[hsl(var(--text-primary))] font-medium">
                          {prompt.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resources */}
              {selectedServer.resources && selectedServer.resources.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <FileText className="h-3 w-3" />
                    <span>Resources ({selectedServer.resources.length})</span>
                  </div>
                  <div className="space-y-1">
                    {selectedServer.resources.slice(0, 3).map((resource, i) => (
                      <div key={i} className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
                        <span className="text-[10px] text-[hsl(var(--text-primary))]">
                          {resource.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Repository Link */}
              {selectedServer.repository?.url && (
                <a
                  href={selectedServer.repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan)/0.8)]"
                >
                  <ExternalLink className="h-3 w-3" />
                  View Repository
                </a>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
            <div className="text-center">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-[10px] uppercase tracking-wider">
                Select a server
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
