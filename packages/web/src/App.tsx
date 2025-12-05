import { useState } from 'react';
import { Plus, Box, AlertCircle, CheckCircle, Settings, FolderOpen } from 'lucide-react';
import { ContainerList } from './components/ContainerList';
import { CreateContainerForm } from './components/CreateContainerForm';
import { VolumeManager } from './components/VolumeManager';
import { DockerfileEditor } from './components/DockerfileEditor';
import { ImageList } from './components/ImageList';
import { SettingsModal } from './components/SettingsModal';
import { ComposeManager } from './components/ComposeManager';
import { useHealth, useConfig } from './hooks/useContainers';

type Tab = 'containers' | 'dockerfiles' | 'images' | 'compose';

function App() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('containers');
  const { data: health } = useHealth();
  const { data: config } = useConfig();

  const dockerConnected = health?.docker === 'connected';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="border-b bg-white shadow-sm dark:border-gray-800 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Box className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  Agent Containers
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Isolated environments for agentic coding
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-3">
                {/* Docker status */}
                <div className="flex items-center gap-1.5 text-sm">
                  {dockerConnected ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className={dockerConnected ? "text-gray-600 dark:text-gray-400" : "text-red-600 dark:text-red-400"}>
                    Docker
                  </span>
                </div>

                <button
                  onClick={() => setShowSettings(true)}
                  className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Settings"
                >
                  <Settings className="h-5 w-5" />
                </button>

                <button
                  onClick={() => setShowCreateForm(true)}
                  className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  New Container
                </button>
              </div>
              {config?.dataDirectory && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                  <FolderOpen className="h-3 w-3" />
                  <span>{config.dataDirectory}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <nav className="mt-4 flex gap-4">
            <button
              onClick={() => setActiveTab('containers')}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
                activeTab === 'containers'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              Containers
            </button>
            <button
              onClick={() => setActiveTab('dockerfiles')}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
                activeTab === 'dockerfiles'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              Dockerfiles
            </button>
            <button
              onClick={() => setActiveTab('images')}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
                activeTab === 'images'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              Images
            </button>
            <button
              onClick={() => setActiveTab('compose')}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
                activeTab === 'compose'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              Compose
            </button>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {activeTab === 'compose' ? (
          <ComposeManager />
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main panel */}
            <div className="lg:col-span-2">
              {activeTab === 'containers' && <ContainerList />}
              {activeTab === 'dockerfiles' && <DockerfileEditor />}
              {activeTab === 'images' && <ImageList />}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <VolumeManager />

              {/* Quick help */}
              <div className="rounded-lg border bg-white p-4 dark:bg-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                  Quick Start
                </h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                  <li>Create a volume for persistent storage</li>
                  <li>Click "New Container" to create an environment</li>
                  <li>Download the SSH key when prompted</li>
                  <li>Copy the SSH command to connect</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {showCreateForm && (
        <CreateContainerForm onClose={() => setShowCreateForm(false)} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

export default App;
