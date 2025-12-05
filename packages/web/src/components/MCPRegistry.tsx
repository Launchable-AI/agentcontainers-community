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
  ChevronLeft,
  X,
  Terminal,
  Wrench,
  MessageSquare,
  FileText,
  Star,
  BookOpen,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as api from '../api/client';
import type { MCPServer } from '../api/client';

type ViewMode = 'all' | 'favorites';
type DetailTab = 'info' | 'readme';

const PAGE_SIZE = 50;

export function MCPRegistry() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [totalServers, setTotalServers] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ lastSynced: string | null; count: number } | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [readme, setReadme] = useState<string | null>(null);
  const [isLoadingReadme, setIsLoadingReadme] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setCurrentPage(0); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load registry status and favorites on mount
  useEffect(() => {
    loadStatus();
    loadFavorites();
  }, []);

  // Search when debounced query or page changes
  useEffect(() => {
    if (syncStatus && syncStatus.count > 0) {
      if (viewMode === 'all') {
        searchServers(debouncedQuery, currentPage);
      }
    }
  }, [debouncedQuery, currentPage, syncStatus, viewMode]);

  // Load favorites when view mode changes
  useEffect(() => {
    if (viewMode === 'favorites') {
      loadFavoriteServers();
    }
  }, [viewMode]);

  const loadStatus = async () => {
    try {
      const status = await api.getMCPRegistryStatus();
      setSyncStatus(status);
      if (status.count > 0) {
        searchServers('', 0);
      }
    } catch (err) {
      console.error('Failed to load MCP registry status:', err);
    }
  };

  const loadFavorites = async () => {
    try {
      const result = await api.getMCPFavorites();
      setFavorites(new Set(result.favorites));
    } catch (err) {
      console.error('Failed to load favorites:', err);
    }
  };

  const loadFavoriteServers = async () => {
    setIsLoading(true);
    try {
      const result = await api.getMCPFavorites();
      setServers(result.servers);
      setTotalServers(result.servers.length);
      setFavorites(new Set(result.favorites));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load favorites');
    }
    setIsLoading(false);
  };

  const searchServers = async (query: string, page: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.searchMCPServers(query, PAGE_SIZE, page * PAGE_SIZE);
      setServers(result.servers);
      setTotalServers(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
    setIsLoading(false);
  };

  const selectServer = async (server: MCPServer) => {
    setIsLoadingDetails(true);
    setReadme(null);
    setDetailTab('info');
    try {
      const fullServer = await api.getMCPServer(server.name);
      setSelectedServer(fullServer);
    } catch (err) {
      setSelectedServer(server);
    }
    setIsLoadingDetails(false);
  };

  const loadReadme = async (serverName: string) => {
    setIsLoadingReadme(true);
    try {
      const result = await api.getMCPReadme(serverName);
      setReadme(result.content);
    } catch (err) {
      setReadme(null);
    }
    setIsLoadingReadme(false);
  };

  const handleDetailTabChange = (tab: DetailTab) => {
    setDetailTab(tab);
    if (tab === 'readme' && selectedServer && !readme) {
      loadReadme(selectedServer.name);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      await api.syncMCPRegistry(
        (message) => console.log('Sync progress:', message),
        (result) => {
          setSyncStatus({ lastSynced: result.timestamp, count: result.count });
          setCurrentPage(0);
          searchServers(debouncedQuery, 0);
        },
        (error) => setError(error)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
    setIsSyncing(false);
  };

  const toggleFavorite = async (serverName: string) => {
    const isFav = favorites.has(serverName);
    try {
      if (isFav) {
        await api.removeMCPFavorite(serverName);
        setFavorites(prev => {
          const next = new Set(prev);
          next.delete(serverName);
          return next;
        });
        if (viewMode === 'favorites') {
          setServers(prev => prev.filter(s => s.name !== serverName));
          setTotalServers(prev => prev - 1);
        }
      } else {
        await api.addMCPFavorite(serverName);
        setFavorites(prev => new Set(prev).add(serverName));
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
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

  const totalPages = Math.ceil(totalServers / PAGE_SIZE);

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
        {/* View Mode Tabs */}
        <div className="flex items-center border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <button
            onClick={() => setViewMode('all')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              viewMode === 'all'
                ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
                : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
            }`}
          >
            All Servers
          </button>
          <button
            onClick={() => setViewMode('favorites')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              viewMode === 'favorites'
                ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
                : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
            }`}
          >
            <Star className="h-3 w-3" />
            Favorites ({favorites.size})
          </button>
        </div>

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
              disabled={viewMode === 'favorites'}
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
            {viewMode === 'favorites' ? (
              `${totalServers} favorites`
            ) : (
              <>
                {totalServers.toLocaleString()} {searchQuery ? 'results' : 'servers'}
                {totalPages > 1 && ` (page ${currentPage + 1} of ${totalPages})`}
              </>
            )}
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
              {viewMode === 'favorites' ? 'No favorites yet' : 'No servers found'}
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {servers.map((server) => (
                <div
                  key={server.name}
                  className={`flex items-start gap-2 p-3 hover:bg-[hsl(var(--bg-elevated))] transition-colors ${
                    selectedServer?.name === server.name ? 'bg-[hsl(var(--bg-elevated))]' : ''
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(server.name);
                    }}
                    className={`p-1 mt-0.5 transition-colors ${
                      favorites.has(server.name)
                        ? 'text-[hsl(var(--amber))]'
                        : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))]'
                    }`}
                    title={favorites.has(server.name) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star className={`h-3.5 w-3.5 ${favorites.has(server.name) ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={() => selectServer(server)}
                    className="flex-1 text-left min-w-0"
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
                          {server.packages?.slice(0, 2).map((pkg, i) => (
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
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {viewMode === 'all' && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
            >
              <ChevronLeft className="h-3 w-3" />
              Previous
            </button>
            <span className="text-[10px] text-[hsl(var(--text-muted))]">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Server Detail Panel */}
      <div className="w-[450px] flex flex-col bg-[hsl(var(--bg-surface))]">
        {isLoadingDetails ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
          </div>
        ) : selectedServer ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-[hsl(var(--border))]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">
                      {selectedServer.title || selectedServer.name}
                    </h3>
                    <button
                      onClick={() => toggleFavorite(selectedServer.name)}
                      className={`p-1 transition-colors ${
                        favorites.has(selectedServer.name)
                          ? 'text-[hsl(var(--amber))]'
                          : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))]'
                      }`}
                    >
                      <Star className={`h-4 w-4 ${favorites.has(selectedServer.name) ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] font-mono mt-0.5 truncate">
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

            {/* Detail Tabs */}
            <div className="flex border-b border-[hsl(var(--border))]">
              <button
                onClick={() => handleDetailTabChange('info')}
                className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                  detailTab === 'info'
                    ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
                    : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
                }`}
              >
                Info
              </button>
              <button
                onClick={() => handleDetailTabChange('readme')}
                disabled={!selectedServer.repository?.url}
                className={`flex-1 px-4 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                  detailTab === 'readme'
                    ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
                    : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50'
                }`}
              >
                <BookOpen className="h-3 w-3" />
                README
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
              {detailTab === 'info' ? (
                <div className="space-y-4">
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
                  {selectedServer.packages && selectedServer.packages.length > 0 && (
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
                  )}

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
              ) : (
                /* README Tab */
                <div className="prose prose-sm prose-invert max-w-none">
                  {isLoadingReadme ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
                    </div>
                  ) : readme ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => <h1 className="text-base font-semibold text-[hsl(var(--text-primary))] mt-4 mb-2">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-sm font-semibold text-[hsl(var(--text-primary))] mt-3 mb-2">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-xs font-semibold text-[hsl(var(--text-primary))] mt-2 mb-1">{children}</h3>,
                        p: ({ children }) => <p className="text-xs text-[hsl(var(--text-secondary))] mb-2 leading-relaxed">{children}</p>,
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--cyan))] hover:underline">
                            {children}
                          </a>
                        ),
                        code: ({ className, children }) => {
                          const isBlock = className?.includes('language-');
                          return isBlock ? (
                            <pre className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2 overflow-x-auto text-[10px] my-2">
                              <code>{children}</code>
                            </pre>
                          ) : (
                            <code className="bg-[hsl(var(--bg-base))] px-1 py-0.5 text-[10px] text-[hsl(var(--cyan))]">{children}</code>
                          );
                        },
                        pre: ({ children }) => <>{children}</>,
                        ul: ({ children }) => <ul className="list-disc list-inside text-xs text-[hsl(var(--text-secondary))] mb-2 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside text-xs text-[hsl(var(--text-secondary))] mb-2 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li className="text-xs">{children}</li>,
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-2 border-[hsl(var(--border))] pl-3 my-2 text-[hsl(var(--text-muted))]">
                            {children}
                          </blockquote>
                        ),
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-2">
                            <table className="text-[10px] border-collapse w-full">{children}</table>
                          </div>
                        ),
                        th: ({ children }) => <th className="border border-[hsl(var(--border))] px-2 py-1 bg-[hsl(var(--bg-base))] text-left">{children}</th>,
                        td: ({ children }) => <td className="border border-[hsl(var(--border))] px-2 py-1">{children}</td>,
                        img: ({ src, alt }) => (
                          <img src={src} alt={alt || ''} className="max-w-full h-auto my-2 rounded" />
                        ),
                      }}
                    >
                      {readme}
                    </ReactMarkdown>
                  ) : (
                    <div className="text-center py-8 text-xs text-[hsl(var(--text-muted))]">
                      README not available
                    </div>
                  )}
                </div>
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
