import { useState } from 'react';
import { Plus, Settings, Container, FileCode, Layers, HardDrive, Image, Package } from 'lucide-react';
import { ContainerList } from './components/ContainerList';
import { CreateContainerForm } from './components/CreateContainerForm';
import { VolumeManager } from './components/VolumeManager';
import { DockerfileEditor } from './components/DockerfileEditor';
import { ImageList } from './components/ImageList';
import { SettingsModal } from './components/SettingsModal';
import { ComposeManager } from './components/ComposeManager';
import { MCPRegistry } from './components/MCPRegistry';
import { ConfirmProvider } from './components/ConfirmModal';
import { useHealth, useConfig } from './hooks/useContainers';

type Tab = 'containers' | 'dockerfiles' | 'images' | 'compose' | 'volumes' | 'mcp';

function App() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('containers');
  const { data: health } = useHealth();
  const { data: config } = useConfig();

  const dockerConnected = health?.docker === 'connected';

  const navItems: { id: Tab; label: string; icon: typeof Container }[] = [
    { id: 'containers', label: 'Containers', icon: Container },
    { id: 'compose', label: 'Compose', icon: Layers },
    { id: 'dockerfiles', label: 'Dockerfiles', icon: FileCode },
    { id: 'images', label: 'Images', icon: Image },
    { id: 'volumes', label: 'Volumes', icon: HardDrive },
    { id: 'mcp', label: 'MCP Servers', icon: Package },
  ];

  return (
    <ConfirmProvider>
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[hsl(var(--border))]">
          <div className="relative">
            <img src="/logo.png" alt="Agent Containers" className="h-7 w-7" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[hsl(var(--green))] animate-pulse-glow" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[hsl(var(--text-primary))] tracking-tight">
              Agent Containers
            </h1>
            <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
              Control Panel
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 mb-0.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border-l-2 border-[hsl(var(--cyan))]'
                    : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border-l-2 border-transparent'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="p-3 border-t border-[hsl(var(--border))] space-y-2">
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Container
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${dockerConnected ? 'bg-[hsl(var(--green))] glow-green' : 'bg-[hsl(var(--red))]'}`} />
              <span className={dockerConnected ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--red))]'}>
                Docker {dockerConnected ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
          {config?.dataDirectory && (
            <div className="mt-1.5 text-[10px] text-[hsl(var(--text-muted))] truncate" title={config.dataDirectory}>
              {config.dataDirectory}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[hsl(var(--bg-base))]">
        {/* Content Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <h2 className="text-sm font-semibold text-[hsl(var(--text-primary))] uppercase tracking-wider">
            {navItems.find(n => n.id === activeTab)?.label}
          </h2>
          <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'containers' && <ContainerList />}
          {activeTab === 'compose' && <ComposeManager />}
          {activeTab === 'dockerfiles' && <DockerfileEditor />}
          {activeTab === 'images' && <ImageList />}
          {activeTab === 'volumes' && <VolumeManager />}
          {activeTab === 'mcp' && <MCPRegistry />}
        </div>
      </main>

      {/* Modals */}
      {showCreateForm && (
        <CreateContainerForm onClose={() => setShowCreateForm(false)} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
    </ConfirmProvider>
  );
}

export default App;
