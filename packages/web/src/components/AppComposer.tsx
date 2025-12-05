import { useState, useMemo } from 'react';
import {
  Database,
  Globe,
  Server,
  Zap,
  Package,
  MessageSquare,
  Monitor,
  Code,
  Plus,
  X,
  Copy,
  Check,
  Sparkles,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useComponents, useCreateComponentFromAI, useDeleteComponent } from '../hooks/useContainers';
import type { Component } from '../api/client';
import { useConfirm } from './ConfirmModal';

interface SelectedComponent {
  component: Component;
  serviceName: string;
  ports: Array<{ container: number; host: number }>;
  environment: Record<string, string>;
}

const CATEGORY_ICONS: Record<Component['category'], React.ReactNode> = {
  database: <Database className="h-4 w-4" />,
  cache: <Zap className="h-4 w-4" />,
  web: <Globe className="h-4 w-4" />,
  messaging: <MessageSquare className="h-4 w-4" />,
  storage: <Package className="h-4 w-4" />,
  monitoring: <Monitor className="h-4 w-4" />,
  development: <Code className="h-4 w-4" />,
  other: <Server className="h-4 w-4" />,
};

const CATEGORY_LABELS: Record<Component['category'], string> = {
  database: 'Databases',
  cache: 'Caching',
  web: 'Web Servers',
  messaging: 'Messaging',
  storage: 'Storage',
  monitoring: 'Monitoring',
  development: 'Development',
  other: 'Other',
};

interface AppComposerProps {
  onApplyCompose: (yaml: string) => void;
  onClose: () => void;
}

export function AppComposer({ onApplyCompose, onClose }: AppComposerProps) {
  const { data: components, isLoading } = useComponents();
  const createFromAI = useCreateComponentFromAI();
  const deleteComponent = useDeleteComponent();
  const confirm = useConfirm();

  const [selectedComponents, setSelectedComponents] = useState<SelectedComponent[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<Component['category'] | null>('database');
  const [aiInput, setAiInput] = useState('');
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [editingComponent, setEditingComponent] = useState<string | null>(null);

  // Group components by category
  const componentsByCategory = useMemo(() => {
    if (!components) return {};
    const grouped: Record<string, Component[]> = {};
    for (const comp of components) {
      if (!grouped[comp.category]) {
        grouped[comp.category] = [];
      }
      grouped[comp.category].push(comp);
    }
    return grouped;
  }, [components]);

  // Generate compose YAML from selected components
  const generatedYaml = useMemo(() => {
    if (selectedComponents.length === 0) return '';

    const lines: string[] = ["version: '3.8'", '', 'services:'];
    const volumes = new Set<string>();

    for (const selected of selectedComponents) {
      const { component, serviceName, ports, environment } = selected;
      lines.push(`  ${serviceName}:`);
      lines.push(`    image: ${component.image}:${component.defaultTag}`);

      // Ports
      if (ports.length > 0) {
        lines.push('    ports:');
        for (const port of ports) {
          lines.push(`      - "${port.host}:${port.container}"`);
        }
      }

      // Volumes
      if (component.volumes.length > 0) {
        lines.push('    volumes:');
        for (const vol of component.volumes) {
          lines.push(`      - ${vol.name}:${vol.path}`);
          volumes.add(vol.name);
        }
      }

      // Environment
      const envEntries = Object.entries(environment);
      if (envEntries.length > 0) {
        lines.push('    environment:');
        for (const [name, value] of envEntries) {
          lines.push(`      ${name}: "${value}"`);
        }
      }

      // Healthcheck
      if (component.healthcheck) {
        lines.push('    healthcheck:');
        lines.push(`      test: ["CMD-SHELL", "${component.healthcheck.test}"]`);
        if (component.healthcheck.interval) {
          lines.push(`      interval: ${component.healthcheck.interval}`);
        }
        if (component.healthcheck.timeout) {
          lines.push(`      timeout: ${component.healthcheck.timeout}`);
        }
        if (component.healthcheck.retries) {
          lines.push(`      retries: ${component.healthcheck.retries}`);
        }
      }

      lines.push('    restart: unless-stopped');
      lines.push('');
    }

    // Add volumes section
    if (volumes.size > 0) {
      lines.push('volumes:');
      for (const vol of volumes) {
        lines.push(`  ${vol}:`);
      }
    }

    return lines.join('\n');
  }, [selectedComponents]);

  const handleAddComponent = (component: Component) => {
    // Generate unique service name
    let serviceName = component.id;
    let counter = 1;
    while (selectedComponents.some(sc => sc.serviceName === serviceName)) {
      serviceName = `${component.id}_${counter}`;
      counter++;
    }

    // Set up default ports and environment
    const ports = component.ports
      .filter(p => p.host)
      .map(p => ({ container: p.container, host: p.host! }));

    const environment: Record<string, string> = {};
    for (const env of component.environment) {
      environment[env.name] = env.value;
    }

    setSelectedComponents(prev => [...prev, {
      component,
      serviceName,
      ports,
      environment,
    }]);
  };

  const handleRemoveSelected = (index: number) => {
    setSelectedComponents(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateServiceName = (index: number, newName: string) => {
    setSelectedComponents(prev => prev.map((sc, i) =>
      i === index ? { ...sc, serviceName: newName } : sc
    ));
  };

  const handleUpdatePort = (compIndex: number, portIndex: number, newHost: number) => {
    setSelectedComponents(prev => prev.map((sc, i) =>
      i === compIndex ? {
        ...sc,
        ports: sc.ports.map((p, pi) => pi === portIndex ? { ...p, host: newHost } : p)
      } : sc
    ));
  };

  const handleUpdateEnv = (compIndex: number, envName: string, newValue: string) => {
    setSelectedComponents(prev => prev.map((sc, i) =>
      i === compIndex ? {
        ...sc,
        environment: { ...sc.environment, [envName]: newValue }
      } : sc
    ));
  };

  const handleCopyYaml = async () => {
    await navigator.clipboard.writeText(generatedYaml);
    setCopiedYaml(true);
    setTimeout(() => setCopiedYaml(false), 2000);
  };

  const handleApply = () => {
    onApplyCompose(generatedYaml);
    onClose();
  };

  const handleAICreate = async () => {
    if (!aiInput.trim()) return;
    try {
      await createFromAI.mutateAsync(aiInput.trim());
      setAiInput('');
    } catch (error) {
      console.error('Failed to create component:', error);
    }
  };

  const handleDeleteComponent = async (id: string, name: string, builtIn: boolean) => {
    if (builtIn) return;

    const confirmed = await confirm({
      title: 'Delete Component',
      message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      try {
        await deleteComponent.mutateAsync(id);
      } catch (error) {
        console.error('Failed to delete component:', error);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="flex items-center gap-2 text-[hsl(var(--text-muted))]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading components...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-black/70">
      <div className="flex-1 flex m-4 gap-4 animate-scale-in">
        {/* Component Library Panel */}
        <div className="w-80 flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">Component Library</h2>
            <button
              onClick={onClose}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* AI Component Creator */}
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
            <div className="flex items-center gap-1.5 mb-2 text-[10px] text-[hsl(var(--purple))] uppercase tracking-wider">
              <Sparkles className="h-3 w-3" />
              <span>AI Component Creator</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAICreate();
                  }
                }}
                placeholder='e.g., "add cassandra"'
                disabled={createFromAI.isPending}
                className="flex-1 px-2 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] disabled:opacity-50"
              />
              <button
                onClick={handleAICreate}
                disabled={createFromAI.isPending || !aiInput.trim()}
                className="px-2.5 py-1.5 bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)] disabled:opacity-50"
              >
                {createFromAI.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {createFromAI.isError && (
              <p className="mt-1.5 text-[10px] text-[hsl(var(--red))]">
                {createFromAI.error instanceof Error ? createFromAI.error.message : 'Failed to create component'}
              </p>
            )}
          </div>

          {/* Component Categories */}
          <div className="flex-1 overflow-auto">
            {Object.entries(componentsByCategory).map(([category, categoryComponents]) => (
              <div key={category} className="border-b border-[hsl(var(--border))]">
                <button
                  onClick={() => setExpandedCategory(
                    expandedCategory === category ? null : category as Component['category']
                  )}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))]"
                >
                  <div className="flex items-center gap-2">
                    {CATEGORY_ICONS[category as Component['category']]}
                    <span>{CATEGORY_LABELS[category as Component['category']]}</span>
                    <span className="text-[hsl(var(--text-muted))]">({categoryComponents.length})</span>
                  </div>
                  {expandedCategory === category ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>

                {expandedCategory === category && (
                  <div className="pb-2">
                    {categoryComponents.map((comp) => (
                      <div
                        key={comp.id}
                        className="mx-2 mb-1 p-2.5 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] hover:border-[hsl(var(--cyan)/0.5)] transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-sm">{comp.icon}</span>
                              <span className="text-xs font-medium text-[hsl(var(--text-primary))]">{comp.name}</span>
                              {comp.builtIn && (
                                <span className="px-1 py-0.5 text-[8px] bg-[hsl(var(--cyan)/0.1)] text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.2)]">
                                  BUILT-IN
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-[hsl(var(--text-muted))] truncate">{comp.description}</p>
                            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-[hsl(var(--text-muted))]">
                              <span>{comp.image}:{comp.defaultTag}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => handleAddComponent(comp)}
                              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))]"
                              title="Add to compose"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            {!comp.builtIn && (
                              <button
                                onClick={() => handleDeleteComponent(comp.id, comp.name, comp.builtIn)}
                                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete component"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Selected Components & YAML Preview */}
        <div className="flex-1 flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Your Stack ({selectedComponents.length} components)
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyYaml}
                disabled={selectedComponents.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50"
              >
                {copiedYaml ? (
                  <>
                    <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy YAML
                  </>
                )}
              </button>
              <button
                onClick={handleApply}
                disabled={selectedComponents.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Apply to Editor
              </button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Selected Components List */}
            <div className="w-1/2 border-r border-[hsl(var(--border))] overflow-auto p-4">
              {selectedComponents.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
                  <div className="text-center">
                    <Server className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-xs">Click a component to add it to your stack</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedComponents.map((selected, index) => (
                    <div
                      key={`${selected.component.id}-${index}`}
                      className="p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]"
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{selected.component.icon}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              {editingComponent === `${index}-name` ? (
                                <input
                                  type="text"
                                  value={selected.serviceName}
                                  onChange={(e) => handleUpdateServiceName(index, e.target.value)}
                                  onBlur={() => setEditingComponent(null)}
                                  onKeyDown={(e) => e.key === 'Enter' && setEditingComponent(null)}
                                  className="px-1 py-0.5 text-xs font-medium bg-[hsl(var(--input-bg))] border border-[hsl(var(--cyan))] text-[hsl(var(--text-primary))] w-32"
                                  autoFocus
                                />
                              ) : (
                                <button
                                  onClick={() => setEditingComponent(`${index}-name`)}
                                  className="text-xs font-medium text-[hsl(var(--cyan))] hover:underline"
                                >
                                  {selected.serviceName}
                                </button>
                              )}
                              <span className="text-[10px] text-[hsl(var(--text-muted))]">{selected.component.name}</span>
                            </div>
                            <p className="text-[10px] text-[hsl(var(--text-muted))]">
                              {selected.component.image}:{selected.component.defaultTag}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveSelected(index)}
                          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Ports */}
                      {selected.ports.length > 0 && (
                        <div className="mb-2">
                          <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Ports</div>
                          <div className="flex flex-wrap gap-1.5">
                            {selected.ports.map((port, pi) => (
                              <div key={pi} className="flex items-center gap-1 text-[10px]">
                                <input
                                  type="number"
                                  value={port.host}
                                  onChange={(e) => handleUpdatePort(index, pi, parseInt(e.target.value) || 0)}
                                  className="w-14 px-1.5 py-0.5 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] text-center"
                                />
                                <span className="text-[hsl(var(--text-muted))]">:</span>
                                <span className="text-[hsl(var(--cyan))]">{port.container}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Environment */}
                      {Object.keys(selected.environment).length > 0 && (
                        <div>
                          <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Environment</div>
                          <div className="space-y-1">
                            {Object.entries(selected.environment).map(([name, value]) => (
                              <div key={name} className="flex items-center gap-1.5 text-[10px]">
                                <span className="text-[hsl(var(--text-muted))] w-32 truncate">{name}</span>
                                <input
                                  type="text"
                                  value={value}
                                  onChange={(e) => handleUpdateEnv(index, name, e.target.value)}
                                  className="flex-1 px-1.5 py-0.5 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* YAML Preview */}
            <div className="w-1/2 flex flex-col bg-[hsl(var(--bg-base))]">
              <div className="px-3 py-2 text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider border-b border-[hsl(var(--border))]">
                Generated docker-compose.yml
              </div>
              <pre className="flex-1 p-4 overflow-auto text-xs text-[hsl(var(--text-secondary))] font-mono leading-relaxed">
                {generatedYaml || '# Add components to generate YAML'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
