import { useState, useMemo, useEffect } from 'react';
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
  HardDrive,
} from 'lucide-react';
import { useComponents, useCreateComponentFromAI, useDeleteComponent, useVolumes } from '../hooks/useContainers';
import type { Component } from '../api/client';
import { useConfirm } from './ConfirmModal';
import YAML from 'yaml';

interface VolumeMapping {
  name: string;
  path: string;
  isNew: boolean; // true = will create new volume, false = existing
}

interface SelectedComponent {
  component: Component;
  serviceName: string;
  ports: Array<{ container: number; host: number }>;
  environment: Record<string, string>;
  volumes: VolumeMapping[];
}

interface PreservedService {
  name: string;
  config: Record<string, unknown>;
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
  currentContent?: string;
}

export function AppComposer({ onApplyCompose, onClose, currentContent }: AppComposerProps) {
  const { data: components, isLoading } = useComponents();
  const { data: existingVolumes } = useVolumes();
  const createFromAI = useCreateComponentFromAI();
  const deleteComponent = useDeleteComponent();
  const confirm = useConfirm();

  const [selectedComponents, setSelectedComponents] = useState<SelectedComponent[]>([]);
  const [preservedServices, setPreservedServices] = useState<PreservedService[]>([]);
  const [preservedVolumes, setPreservedVolumes] = useState<Record<string, unknown>>({});
  const [expandedCategory, setExpandedCategory] = useState<Component['category'] | null>('database');
  const [aiInput, setAiInput] = useState('');
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [editingComponent, setEditingComponent] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [showVolumeMenu, setShowVolumeMenu] = useState<{ compIndex: number; volIndex: number } | null>(null);

  // List of volume names already used
  const existingVolumeNames = useMemo(() => {
    return existingVolumes?.map(v => v.name) || [];
  }, [existingVolumes]);

  // Parse current compose content and extract dev-node + match library components
  useEffect(() => {
    if (initialized || !components || !currentContent) return;

    try {
      const parsed = YAML.parse(currentContent);
      const services = parsed?.services;
      const yamlVolumes = parsed?.volumes || {};

      if (!services || typeof services !== 'object') {
        setInitialized(true);
        return;
      }

      const matched: SelectedComponent[] = [];
      const preserved: PreservedService[] = [];

      for (const [serviceName, serviceConfig] of Object.entries(services)) {
        const config = serviceConfig as Record<string, unknown>;
        const imageStr = config.image as string | undefined;

        // Check if this is a dev-node or custom service (preserve it)
        const isDevNode = serviceName === 'dev-node' || serviceName === 'dev' || serviceName === 'development';
        const isCustomImage = imageStr?.startsWith('acm-') || !imageStr;

        if (isDevNode || isCustomImage) {
          preserved.push({ name: serviceName, config });
          continue;
        }

        // Parse image name (remove tag)
        const imageName = imageStr?.split(':')[0];

        // Try to find a matching component by image name
        const matchedComponent = components.find(c =>
          c.image === imageName ||
          c.image.endsWith(`/${imageName}`) ||
          imageName?.endsWith(`/${c.image}`)
        );

        if (matchedComponent) {
          // Parse ports
          const ports: Array<{ container: number; host: number }> = [];
          const configPorts = config.ports as Array<string | { published?: number; target?: number }> | undefined;
          if (configPorts) {
            for (const port of configPorts) {
              if (typeof port === 'string') {
                const parts = port.split(':').map(p => parseInt(p));
                if (parts.length === 2 && parts[0] && parts[1]) {
                  ports.push({ host: parts[0], container: parts[1] });
                }
              } else if (typeof port === 'object' && port.published && port.target) {
                ports.push({ host: port.published, container: port.target });
              }
            }
          }

          // Parse environment
          const environment: Record<string, string> = {};
          const configEnv = config.environment;
          if (configEnv) {
            if (Array.isArray(configEnv)) {
              for (const env of configEnv) {
                const [name, value] = (env as string).split('=');
                if (name) environment[name] = value || '';
              }
            } else if (typeof configEnv === 'object') {
              for (const [name, value] of Object.entries(configEnv as Record<string, string>)) {
                environment[name] = String(value);
              }
            }
          }

          // Parse volumes
          const volumes: VolumeMapping[] = [];
          const configVolumes = config.volumes as string[] | undefined;
          if (configVolumes) {
            for (const vol of configVolumes) {
              const [name, path] = vol.split(':');
              if (name && path) {
                volumes.push({
                  name,
                  path,
                  isNew: !existingVolumeNames.includes(name)
                });
              }
            }
          }

          matched.push({
            component: matchedComponent,
            serviceName,
            ports: ports.length > 0 ? ports : matchedComponent.ports.filter(p => p.host).map(p => ({ container: p.container, host: p.host! })),
            environment: Object.keys(environment).length > 0 ? environment : matchedComponent.environment.reduce((acc, e) => ({ ...acc, [e.name]: e.value }), {}),
            volumes: volumes.length > 0 ? volumes : matchedComponent.volumes.map(v => ({
              name: v.name,
              path: v.path,
              isNew: !existingVolumeNames.includes(v.name)
            })),
          });
        } else {
          // Unknown service - preserve it
          preserved.push({ name: serviceName, config });
        }
      }

      // Ensure there's always a dev-node service
      const hasDevNode = preserved.some(s =>
        s.name === 'dev-node' || s.name === 'dev' || s.name === 'development'
      );

      if (!hasDevNode) {
        // Add default dev-node with workspace volume
        preserved.unshift({
          name: 'dev-node',
          config: {
            image: 'ubuntu:24.04',
            command: 'sleep infinity',
            volumes: ['workspace:/home/dev/workspace'],
          }
        });
      }

      setPreservedServices(preserved);
      setPreservedVolumes(yamlVolumes);
      if (matched.length > 0) {
        setSelectedComponents(matched);
      }
    } catch (error) {
      console.error('Failed to parse compose content:', error);
    }

    setInitialized(true);
  }, [components, currentContent, initialized, existingVolumeNames]);

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

  // Generate compose YAML from selected components + preserved services
  const generatedYaml = useMemo(() => {
    const lines: string[] = ["version: '3.8'", '', 'services:'];
    const allVolumes = new Set<string>();

    // First add preserved services (dev-node, etc.)
    for (const preserved of preservedServices) {
      lines.push(`  ${preserved.name}:`);
      // Re-serialize the preserved config
      const configYaml = YAML.stringify(preserved.config).split('\n');
      for (const line of configYaml) {
        if (line.trim()) {
          lines.push(`    ${line}`);
        }
      }
      lines.push('');

      // Extract volume names from preserved service
      const preservedVols = preserved.config.volumes as string[] | undefined;
      if (preservedVols) {
        for (const vol of preservedVols) {
          const name = vol.split(':')[0];
          if (name && !name.startsWith('/') && !name.startsWith('.')) {
            allVolumes.add(name);
          }
        }
      }
    }

    // Then add selected components
    for (const selected of selectedComponents) {
      const { component, serviceName, ports, environment, volumes } = selected;
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
      if (volumes.length > 0) {
        lines.push('    volumes:');
        for (const vol of volumes) {
          lines.push(`      - ${vol.name}:${vol.path}`);
          allVolumes.add(vol.name);
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

    // Add volumes section - use a Set to avoid duplicates
    const volumeNames = new Set<string>();

    // Collect all unique volume names
    for (const volName of Object.keys(preservedVolumes)) {
      volumeNames.add(volName);
    }
    for (const vol of allVolumes) {
      volumeNames.add(vol);
    }

    if (volumeNames.size > 0) {
      lines.push('volumes:');
      for (const volName of volumeNames) {
        lines.push(`  ${volName}:`);
      }
    }

    return lines.join('\n');
  }, [selectedComponents, preservedServices, preservedVolumes]);

  const handleAddComponent = (component: Component) => {
    // Generate unique service name
    let serviceName = component.id;
    let counter = 1;
    while (
      selectedComponents.some(sc => sc.serviceName === serviceName) ||
      preservedServices.some(ps => ps.name === serviceName)
    ) {
      serviceName = `${component.id}_${counter}`;
      counter++;
    }

    // Set up default ports, environment, and volumes
    const ports = component.ports
      .filter(p => p.host)
      .map(p => ({ container: p.container, host: p.host! }));

    const environment: Record<string, string> = {};
    for (const env of component.environment) {
      environment[env.name] = env.value;
    }

    // Generate intelligent volume names
    const volumes: VolumeMapping[] = component.volumes.map(v => ({
      name: `${serviceName}_${v.name.replace(component.id + '_', '')}`,
      path: v.path,
      isNew: true,
    }));

    setSelectedComponents(prev => [...prev, {
      component,
      serviceName,
      ports,
      environment,
      volumes,
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

  const handleUpdateVolumeName = (compIndex: number, volIndex: number, newName: string, isNew: boolean) => {
    setSelectedComponents(prev => prev.map((sc, i) =>
      i === compIndex ? {
        ...sc,
        volumes: sc.volumes.map((v, vi) => vi === volIndex ? { ...v, name: newName, isNew } : v)
      } : sc
    ));
    setShowVolumeMenu(null);
  };

  const handleAddVolume = (compIndex: number, path: string) => {
    const serviceName = selectedComponents[compIndex].serviceName;
    const newVolName = `${serviceName}_data_${Date.now()}`;
    setSelectedComponents(prev => prev.map((sc, i) =>
      i === compIndex ? {
        ...sc,
        volumes: [...sc.volumes, { name: newVolName, path, isNew: true }]
      } : sc
    ));
  };

  const handleRemoveVolume = (compIndex: number, volIndex: number) => {
    setSelectedComponents(prev => prev.map((sc, i) =>
      i === compIndex ? {
        ...sc,
        volumes: sc.volumes.filter((_, vi) => vi !== volIndex)
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

  const handleDeleteLibraryComponent = async (id: string, name: string, builtIn: boolean) => {
    if (builtIn) return;

    const confirmed = await confirm({
      title: 'Delete Component',
      message: `Are you sure you want to delete "${name}" from the library? This cannot be undone.`,
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
    <div className="fixed inset-0 z-50 flex bg-black/70" onClick={() => setShowVolumeMenu(null)}>
      <div className="flex-1 flex m-4 gap-4 animate-scale-in" onClick={e => e.stopPropagation()}>
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
                                onClick={() => handleDeleteLibraryComponent(comp.id, comp.name, comp.builtIn)}
                                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete from library"
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
            <div>
              <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                Your Stack
              </h2>
              <p className="text-[10px] text-[hsl(var(--text-muted))]">
                {preservedServices.length > 0 && (
                  <span className="text-[hsl(var(--cyan))]">{preservedServices.length} preserved</span>
                )}
                {preservedServices.length > 0 && selectedComponents.length > 0 && ' + '}
                {selectedComponents.length > 0 && (
                  <span>{selectedComponents.length} components</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyYaml}
                disabled={selectedComponents.length === 0 && preservedServices.length === 0}
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
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={handleApply}
                disabled={selectedComponents.length === 0 && preservedServices.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Apply
              </button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Selected Components List */}
            <div className="w-1/2 border-r border-[hsl(var(--border))] overflow-auto p-4">
              {/* Preserved Services Notice */}
              {preservedServices.length > 0 && (
                <div className="mb-4 p-3 bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.2)]">
                  <div className="flex items-center gap-2 mb-2">
                    <Code className="h-4 w-4 text-[hsl(var(--cyan))]" />
                    <span className="text-xs font-medium text-[hsl(var(--cyan))]">Preserved Services</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preservedServices.map(ps => (
                      <span key={ps.name} className="px-2 py-1 text-[10px] bg-[hsl(var(--bg-base))] text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]">
                        {ps.name}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-[hsl(var(--text-muted))]">
                    Your dev-node and custom services are preserved
                  </p>
                </div>
              )}

              {selectedComponents.length === 0 && preservedServices.length === 0 ? (
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

                      {/* Volumes */}
                      <div className="mb-2">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider flex items-center gap-1">
                            <HardDrive className="h-3 w-3" />
                            Volumes
                          </div>
                          <button
                            onClick={() => handleAddVolume(index, '/data')}
                            className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
                            title="Add volume"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="space-y-1">
                          {selected.volumes.map((vol, vi) => (
                            <div key={vi} className="flex items-center gap-1.5 text-[10px]">
                              <div className="relative flex-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowVolumeMenu(showVolumeMenu?.compIndex === index && showVolumeMenu?.volIndex === vi ? null : { compIndex: index, volIndex: vi });
                                  }}
                                  className={`w-full px-1.5 py-0.5 text-left bg-[hsl(var(--input-bg))] border text-[hsl(var(--text-primary))] hover:border-[hsl(var(--cyan)/0.5)] flex items-center justify-between ${
                                    vol.isNew ? 'border-[hsl(var(--green)/0.3)]' : 'border-[hsl(var(--border))]'
                                  }`}
                                >
                                  <span className="truncate">{vol.name}</span>
                                  <ChevronDown className="h-2.5 w-2.5 ml-1 flex-shrink-0 text-[hsl(var(--text-muted))]" />
                                </button>

                                {/* Volume selector dropdown */}
                                {showVolumeMenu?.compIndex === index && showVolumeMenu?.volIndex === vi && (
                                  <div
                                    className="absolute left-0 top-full mt-1 z-20 w-48 max-h-48 overflow-auto bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {/* Create new option */}
                                    <div className="px-2 py-1 text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider bg-[hsl(var(--bg-base))]">
                                      Create New
                                    </div>
                                    <button
                                      onClick={() => {
                                        const newName = `${selected.serviceName}_${vol.path.split('/').pop() || 'data'}`;
                                        handleUpdateVolumeName(index, vi, newName, true);
                                      }}
                                      className="w-full px-2 py-1.5 text-left text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-overlay))] flex items-center gap-1.5"
                                    >
                                      <Plus className="h-3 w-3" />
                                      <span>New volume for {selected.serviceName}</span>
                                    </button>

                                    {/* Existing volumes */}
                                    {existingVolumeNames.length > 0 && (
                                      <>
                                        <div className="px-2 py-1 text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider bg-[hsl(var(--bg-base))] border-t border-[hsl(var(--border))]">
                                          Existing Volumes
                                        </div>
                                        {existingVolumeNames.map(volName => (
                                          <button
                                            key={volName}
                                            onClick={() => handleUpdateVolumeName(index, vi, volName, false)}
                                            className={`w-full px-2 py-1.5 text-left hover:bg-[hsl(var(--bg-overlay))] flex items-center gap-1.5 ${
                                              vol.name === volName ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]' : 'text-[hsl(var(--text-secondary))]'
                                            }`}
                                          >
                                            <HardDrive className="h-3 w-3" />
                                            <span>{volName}</span>
                                            {vol.name === volName && <Check className="h-3 w-3 ml-auto" />}
                                          </button>
                                        ))}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <span className="text-[hsl(var(--text-muted))]">→</span>
                              <span className="text-[hsl(var(--cyan))] truncate flex-1">{vol.path}</span>
                              <button
                                onClick={() => handleRemoveVolume(index, vi)}
                                className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          {selected.volumes.length === 0 && (
                            <p className="text-[hsl(var(--text-muted))] italic">No volumes</p>
                          )}
                        </div>
                      </div>

                      {/* Environment */}
                      {Object.keys(selected.environment).length > 0 && (
                        <div>
                          <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Environment</div>
                          <div className="space-y-1">
                            {Object.entries(selected.environment).map(([name, value]) => (
                              <div key={name} className="flex items-center gap-1.5 text-[10px]">
                                <span className="text-[hsl(var(--text-muted))] w-28 truncate">{name}</span>
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
