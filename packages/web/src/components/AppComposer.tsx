import { useState, useMemo, useEffect, useRef } from 'react';
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
  FileCode,
  Eye,
  Upload,
  FileText,
  TerminalSquare,
  AlertTriangle,
} from 'lucide-react';
import { useComponents, useCreateComponentFromAI, useDeleteComponent, useVolumes, useConfig, useDockerfiles, useImages } from '../hooks/useContainers';
import type { Component } from '../api/client';
import * as api from '../api/client';
import { useConfirm } from './ConfirmModal';
import YAML from 'yaml';

interface VolumeMapping {
  name: string;
  path: string;
  isNew: boolean;
}

interface ParsedService {
  id: string;
  name: string;
  type: 'library' | 'build' | 'custom'; // library = from component lib, build = has build context, custom = unknown image
  image?: string;
  buildContext?: string;
  dockerfile?: string;
  ports: Array<{ container: number; host: number }>;
  environment: Record<string, string>;
  volumes: VolumeMapping[];
  dependsOn: string[];
  command?: string;
  healthcheck?: {
    test: string;
    interval?: string;
    timeout?: string;
    retries?: number;
  };
  // Reference to library component if matched
  libraryComponent?: Component;
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
  inline?: boolean;
  onConnectToDevContainer?: (containerId: string, serviceName: string) => void;
  devContainerInfo?: { containerId: string; serviceName: string; state: string } | null;
}

export function AppComposer({ onApplyCompose, onClose, currentContent, inline = false, onConnectToDevContainer, devContainerInfo }: AppComposerProps) {
  const { data: components, isLoading } = useComponents();
  const { data: existingVolumes } = useVolumes();
  const { data: config } = useConfig();
  const { data: dockerfiles } = useDockerfiles();
  const { data: images } = useImages();
  const createFromAI = useCreateComponentFromAI();
  const deleteComponent = useDeleteComponent();
  const confirm = useConfirm();

  const defaultDevNodeImage = config?.defaultDevNodeImage || 'ubuntu:24.04';

  // State
  const [services, setServices] = useState<ParsedService[]>([]);
  const [devContainer, setDevContainer] = useState<PreservedService | null>(null);
  const [preservedVolumes, setPreservedVolumes] = useState<Record<string, unknown>>({});
  const [initialized, setInitialized] = useState(false);

  // UI State
  const [showComponentLibrary, setShowComponentLibrary] = useState(false);
  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<Component['category'] | null>('database');
  const [aiInput, setAiInput] = useState('');
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [editingService, setEditingService] = useState<string | null>(null);
  const [showVolumeMenu, setShowVolumeMenu] = useState<{ serviceId: string; volIndex: number } | null>(null);
  const [showDockerfileMenu, setShowDockerfileMenu] = useState<string | null>(null);

  // Dockerfile viewer/editor state
  const [viewingDockerfile, setViewingDockerfile] = useState<{ name: string; content: string; serviceId: string | null } | null>(null);
  const [dockerfileContent, setDockerfileContent] = useState('');
  const [savingDockerfile, setSavingDockerfile] = useState(false);
  const dockerfileInputRef = useRef<HTMLInputElement>(null);

  const existingVolumeNames = useMemo(() => {
    return existingVolumes?.map(v => v.name) || [];
  }, [existingVolumes]);

  // Custom images (acm-* images) for dev container dropdown
  const customImages = useMemo(() => {
    if (!images) return [];
    return images
      .filter(img => img.repoTags?.some(tag => tag.startsWith('acm-')))
      .map(img => img.repoTags?.find(t => t.startsWith('acm-')) || img.repoTags?.[0])
      .filter(Boolean) as string[];
  }, [images]);

  // Check if a dockerfile exists in our system
  // Returns: 'available' | 'missing' | 'external' (external = not managed by us, e.g., "Dockerfile")
  const getDockerfileStatus = (dockerfile: string | undefined): 'available' | 'missing' | 'external' => {
    if (!dockerfile || dockerfile === 'Dockerfile') {
      return 'external'; // Standard Dockerfile, not managed by our system
    }
    // Normalize the name and check if it exists
    // "Dockerfile.dev" -> "dev", "myapp.dockerfile" -> "myapp"
    let normalizedName: string;
    if (dockerfile.endsWith('.dockerfile')) {
      normalizedName = dockerfile.replace('.dockerfile', '');
    } else if (dockerfile.startsWith('Dockerfile.')) {
      normalizedName = dockerfile.replace('Dockerfile.', '');
    } else {
      return 'external';
    }
    // Check if the normalized name exists in our dockerfiles list (which contains "name.dockerfile" entries)
    const exists = dockerfiles?.some(df => df === `${normalizedName}.dockerfile`);
    return exists ? 'available' : 'missing';
  };

  // State for dev container dropdown
  const [showDevContainerDropdown, setShowDevContainerDropdown] = useState(false);

  // Handler to update dev container image
  const handleUpdateDevContainerImage = (newImage: string) => {
    if (devContainer) {
      setDevContainer({
        ...devContainer,
        config: {
          ...devContainer.config,
          image: newImage,
        },
      });
    }
    setShowDevContainerDropdown(false);
  };

  // Helper: detect if a service is a dev container
  const isDevContainer = (serviceName: string, config: Record<string, unknown>): boolean => {
    const imageStr = config.image as string | undefined;
    const command = config.command as string | undefined;
    const volumes = config.volumes as string[] | undefined;
    const devNames = ['dev-node', 'dev', 'development', 'devbox', 'workspace', 'toolbox'];
    const hasDevName = devNames.some(name => serviceName.toLowerCase().includes(name));
    const hasSleepCommand = command?.includes('sleep infinity') || command?.includes('sleep inf');
    const hasWorkspaceMount = volumes?.some(v =>
      v.includes('/workspace') || v.includes('/home/dev') || v.includes('workspace:')
    );
    const hasAcmImage = imageStr?.startsWith('acm-');
    return hasSleepCommand || (hasDevName && hasWorkspaceMount) || hasAcmImage || false;
  };

  // Parse ports from config
  const parsePorts = (configPorts: Array<string | { published?: number; target?: number }> | undefined): Array<{ container: number; host: number }> => {
    const ports: Array<{ container: number; host: number }> = [];
    if (!configPorts) return ports;
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
    return ports;
  };

  // Parse environment from config
  const parseEnvironment = (configEnv: unknown): Record<string, string> => {
    const environment: Record<string, string> = {};
    if (!configEnv) return environment;
    if (Array.isArray(configEnv)) {
      for (const env of configEnv) {
        const [name, ...rest] = (env as string).split('=');
        if (name) environment[name] = rest.join('=') || '';
      }
    } else if (typeof configEnv === 'object') {
      for (const [name, value] of Object.entries(configEnv as Record<string, string>)) {
        environment[name] = String(value);
      }
    }
    return environment;
  };

  // Parse volumes from config
  const parseVolumes = (configVolumes: string[] | undefined): VolumeMapping[] => {
    const volumes: VolumeMapping[] = [];
    if (!configVolumes) return volumes;
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
    return volumes;
  };

  // Parse depends_on from config
  const parseDependsOn = (deps: unknown): string[] => {
    if (!deps) return [];
    if (Array.isArray(deps)) return deps;
    if (typeof deps === 'object') return Object.keys(deps);
    return [];
  };

  // Reset initialized when content changes (new project selected)
  const [lastParsedContent, setLastParsedContent] = useState<string | undefined>(undefined);

  // Parse current compose content
  useEffect(() => {
    // Skip if already parsed this exact content, or if dependencies aren't ready
    if (!components || !currentContent) return;
    if (initialized && currentContent === lastParsedContent) return;

    try {
      const parsed = YAML.parse(currentContent);
      const yamlServices = parsed?.services;
      const yamlVolumes = parsed?.volumes || {};

      if (!yamlServices || typeof yamlServices !== 'object') {
        // No services - add default dev container
        setDevContainer({
          name: 'dev-node',
          config: {
            image: defaultDevNodeImage,
            command: 'sleep infinity',
            volumes: ['workspace:/home/dev/workspace'],
          }
        });
        setInitialized(true);
        setLastParsedContent(currentContent);
        return;
      }

      const parsedServices: ParsedService[] = [];
      let foundDevContainer: PreservedService | null = null;

      for (const [serviceName, serviceConfig] of Object.entries(yamlServices)) {
        const config = serviceConfig as Record<string, unknown>;
        const imageStr = config.image as string | undefined;
        const buildConfig = config.build as string | { context?: string; dockerfile?: string } | undefined;

        // Check if this is a dev container
        if (isDevContainer(serviceName, config)) {
          foundDevContainer = { name: serviceName, config };
          continue;
        }

        // Determine service type
        let type: ParsedService['type'] = 'custom';
        let buildContext: string | undefined;
        let dockerfile: string | undefined;
        let libraryComponent: Component | undefined;

        if (buildConfig) {
          type = 'build';
          if (typeof buildConfig === 'string') {
            buildContext = buildConfig;
          } else {
            buildContext = buildConfig.context;
            dockerfile = buildConfig.dockerfile;
          }
        } else if (imageStr) {
          // Try to match to library component
          const imageName = imageStr.split(':')[0].toLowerCase();
          libraryComponent = components.find(c => {
            const compImage = c.image.toLowerCase();
            return (
              compImage === imageName ||
              compImage.endsWith(`/${imageName}`) ||
              imageName.endsWith(`/${compImage}`) ||
              imageName.includes(compImage) ||
              compImage.includes(imageName)
            );
          });
          if (libraryComponent) {
            type = 'library';
          }
        }

        parsedServices.push({
          id: `${serviceName}-${Date.now()}`,
          name: serviceName,
          type,
          image: imageStr,
          buildContext,
          dockerfile,
          ports: parsePorts(config.ports as Array<string | { published?: number; target?: number }> | undefined),
          environment: parseEnvironment(config.environment),
          volumes: parseVolumes(config.volumes as string[] | undefined),
          dependsOn: parseDependsOn(config.depends_on),
          command: config.command as string | undefined,
          libraryComponent,
        });
      }

      // If no dev container found, add default
      if (!foundDevContainer) {
        foundDevContainer = {
          name: 'dev-node',
          config: {
            image: defaultDevNodeImage,
            command: 'sleep infinity',
            volumes: ['workspace:/home/dev/workspace'],
          }
        };
      }

      setDevContainer(foundDevContainer);
      setServices(parsedServices);
      setPreservedVolumes(yamlVolumes);
    } catch (error) {
      console.error('Failed to parse compose content:', error);
      setDevContainer({
        name: 'dev-node',
        config: {
          image: defaultDevNodeImage,
          command: 'sleep infinity',
          volumes: ['workspace:/home/dev/workspace'],
        }
      });
    }

    setInitialized(true);
    setLastParsedContent(currentContent);
  }, [components, currentContent, initialized, lastParsedContent, existingVolumeNames, defaultDevNodeImage]);

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

  // Generate compose YAML
  const generatedYaml = useMemo(() => {
    const lines: string[] = ["version: '3.8'", '', 'services:'];
    const allVolumes = new Set<string>();

    // First add dev container
    if (devContainer) {
      lines.push(`  ${devContainer.name}:`);
      const configYaml = YAML.stringify(devContainer.config).split('\n');
      for (const line of configYaml) {
        if (line.trim()) {
          lines.push(`    ${line}`);
        }
      }
      lines.push('');

      // Extract volumes from dev container
      const devVols = devContainer.config.volumes as string[] | undefined;
      if (devVols) {
        for (const vol of devVols) {
          const name = vol.split(':')[0];
          if (name && !name.startsWith('/') && !name.startsWith('.')) {
            allVolumes.add(name);
          }
        }
      }
    }

    // Then add all services
    for (const service of services) {
      lines.push(`  ${service.name}:`);

      // Image or build
      if (service.type === 'build' && service.buildContext) {
        lines.push('    build:');
        lines.push(`      context: ${service.buildContext}`);
        if (service.dockerfile) {
          lines.push(`      dockerfile: ${service.dockerfile}`);
        }
      } else if (service.image) {
        lines.push(`    image: ${service.image}`);
      } else if (service.libraryComponent) {
        lines.push(`    image: ${service.libraryComponent.image}:${service.libraryComponent.defaultTag}`);
      }

      // Command
      if (service.command) {
        lines.push(`    command: ${service.command}`);
      }

      // Ports
      if (service.ports.length > 0) {
        lines.push('    ports:');
        for (const port of service.ports) {
          lines.push(`      - "${port.host}:${port.container}"`);
        }
      }

      // Volumes
      if (service.volumes.length > 0) {
        lines.push('    volumes:');
        for (const vol of service.volumes) {
          lines.push(`      - ${vol.name}:${vol.path}`);
          if (!vol.name.startsWith('/') && !vol.name.startsWith('.')) {
            allVolumes.add(vol.name);
          }
        }
      }

      // Environment
      const envEntries = Object.entries(service.environment);
      if (envEntries.length > 0) {
        lines.push('    environment:');
        for (const [name, value] of envEntries) {
          // Handle env vars that reference other vars
          if (value.includes('${')) {
            lines.push(`      ${name}: ${value}`);
          } else {
            lines.push(`      ${name}: "${value}"`);
          }
        }
      }

      // Depends on
      if (service.dependsOn.length > 0) {
        lines.push('    depends_on:');
        for (const dep of service.dependsOn) {
          lines.push(`      - ${dep}`);
        }
      }

      // Healthcheck
      if (service.healthcheck) {
        lines.push('    healthcheck:');
        lines.push(`      test: ["CMD-SHELL", "${service.healthcheck.test}"]`);
        if (service.healthcheck.interval) {
          lines.push(`      interval: ${service.healthcheck.interval}`);
        }
        if (service.healthcheck.timeout) {
          lines.push(`      timeout: ${service.healthcheck.timeout}`);
        }
        if (service.healthcheck.retries) {
          lines.push(`      retries: ${service.healthcheck.retries}`);
        }
      }

      lines.push('');
    }

    // Add volumes section
    const volumeNames = new Set<string>();
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
  }, [services, devContainer, preservedVolumes]);

  // Update YAML content when generated changes
  useEffect(() => {
    setYamlContent(generatedYaml);
  }, [generatedYaml]);

  // Auto-save in inline mode when YAML changes (after initial load)
  useEffect(() => {
    if (!inline || !initialized) return;
    // Don't auto-save the initial content we just parsed
    if (generatedYaml === lastParsedContent) return;
    // Auto-save changes
    onApplyCompose(generatedYaml);
  }, [inline, initialized, generatedYaml, lastParsedContent, onApplyCompose]);

  // Handlers
  const handleAddComponent = (component: Component) => {
    let serviceName = component.id;
    let counter = 1;
    while (services.some(s => s.name === serviceName) || devContainer?.name === serviceName) {
      serviceName = `${component.id}_${counter}`;
      counter++;
    }

    const ports = component.ports
      .filter(p => p.host)
      .map(p => ({ container: p.container, host: p.host! }));

    const environment: Record<string, string> = {};
    for (const env of component.environment) {
      environment[env.name] = env.value;
    }

    const volumes: VolumeMapping[] = component.volumes.map(v => ({
      name: `${serviceName}_${v.name.replace(component.id + '_', '')}`,
      path: v.path,
      isNew: true,
    }));

    setServices(prev => [...prev, {
      id: `${serviceName}-${Date.now()}`,
      name: serviceName,
      type: 'library',
      image: `${component.image}:${component.defaultTag}`,
      ports,
      environment,
      volumes,
      dependsOn: [],
      libraryComponent: component,
      healthcheck: component.healthcheck ? {
        test: component.healthcheck.test,
        interval: component.healthcheck.interval,
        timeout: component.healthcheck.timeout,
        retries: component.healthcheck.retries,
      } : undefined,
    }]);

    setShowComponentLibrary(false);
  };

  const handleAddBuildService = () => {
    const serviceName = `app-${Date.now()}`;
    setServices(prev => [...prev, {
      id: serviceName,
      name: serviceName,
      type: 'build',
      buildContext: '../dockerfiles',  // Relative path from compose dir to dockerfiles dir
      dockerfile: dockerfiles?.[0] || undefined,  // Default to first available dockerfile
      ports: [{ container: 3000, host: 3000 }],
      environment: {},
      volumes: [],
      dependsOn: [],
    }]);
  };

  const handleRemoveService = (serviceId: string) => {
    setServices(prev => prev.filter(s => s.id !== serviceId));
  };

  const handleUpdateServiceName = (serviceId: string, newName: string) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? { ...s, name: newName } : s
    ));
  };

  const handleUpdatePort = (serviceId: string, portIndex: number, field: 'host' | 'container', value: number) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? {
        ...s,
        ports: s.ports.map((p, i) => i === portIndex ? { ...p, [field]: value } : p)
      } : s
    ));
  };

  const handleAddPort = (serviceId: string) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? {
        ...s,
        ports: [...s.ports, { container: 8080, host: 8080 }]
      } : s
    ));
  };

  const handleRemovePort = (serviceId: string, portIndex: number) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? {
        ...s,
        ports: s.ports.filter((_, i) => i !== portIndex)
      } : s
    ));
  };

  const handleUpdateEnvVar = (serviceId: string, key: string, value: string) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? {
        ...s,
        environment: { ...s.environment, [key]: value }
      } : s
    ));
  };

  const handleAddEnvVar = (serviceId: string) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? {
        ...s,
        environment: { ...s.environment, ['NEW_VAR']: '' }
      } : s
    ));
  };

  const handleRemoveEnvVar = (serviceId: string, key: string) => {
    setServices(prev => prev.map(s => {
      if (s.id !== serviceId) return s;
      const { [key]: _, ...rest } = s.environment;
      return { ...s, environment: rest };
    }));
  };

  const handleRenameEnvVar = (serviceId: string, oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    setServices(prev => prev.map(s => {
      if (s.id !== serviceId) return s;
      const { [oldKey]: value, ...rest } = s.environment;
      return { ...s, environment: { ...rest, [newKey]: value } };
    }));
  };

  // Dockerfile upload handler
  const handleDockerfileUpload = async (event: React.ChangeEvent<HTMLInputElement>, serviceId: string) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      // Use the file name without extension as the dockerfile name
      const name = file.name.replace(/\.(dockerfile|Dockerfile)?$/i, '') || 'uploaded';

      // Save the dockerfile to the server
      await api.saveDockerfile(name, content);

      // Update the service to use this dockerfile (this also sets the correct context)
      handleUpdateDockerfile(serviceId, `${name}.dockerfile`);
    } catch (error) {
      console.error('Failed to upload dockerfile:', error);
    }

    // Clear the input
    if (dockerfileInputRef.current) {
      dockerfileInputRef.current.value = '';
    }
  };

  // Normalize dockerfile name for our API
  // Handles: "Dockerfile.dev" -> "dev", "myapp.dockerfile" -> "myapp", "Dockerfile" -> "default"
  const normalizeDockerfileName = (dockerfileName: string): string => {
    // If it ends with .dockerfile, strip it
    if (dockerfileName.endsWith('.dockerfile')) {
      return dockerfileName.replace('.dockerfile', '');
    }
    // If it's "Dockerfile.something", extract the suffix
    if (dockerfileName.startsWith('Dockerfile.')) {
      return dockerfileName.replace('Dockerfile.', '');
    }
    // If it's just "Dockerfile", use a default name
    if (dockerfileName === 'Dockerfile') {
      return 'default';
    }
    // Otherwise use as-is
    return dockerfileName;
  };

  // View dockerfile handler
  const handleViewDockerfile = async (dockerfileName: string, serviceId: string | null = null) => {
    const name = normalizeDockerfileName(dockerfileName);

    try {
      const result = await api.getDockerfile(name);
      setDockerfileContent(result.content);
      setViewingDockerfile({ name, content: result.content, serviceId });
    } catch {
      // If not found in our system, create a placeholder for user to create it
      const defaultContent = `# ${dockerfileName}\n# This Dockerfile is referenced in your compose file but not yet created.\n# Add your Dockerfile content here and save to create it.\n\nFROM ubuntu:24.04\n\n# Add your instructions here\n`;
      setDockerfileContent(defaultContent);
      setViewingDockerfile({ name, content: '', serviceId }); // Empty content means it's new
    }
  };

  // Save dockerfile changes handler
  const handleSaveDockerfile = async () => {
    if (!viewingDockerfile) return;

    setSavingDockerfile(true);
    try {
      await api.saveDockerfile(viewingDockerfile.name, dockerfileContent);
      setViewingDockerfile({ ...viewingDockerfile, content: dockerfileContent });
    } catch (error) {
      console.error('Failed to save dockerfile:', error);
    }
    setSavingDockerfile(false);
  };

  const handleUpdateVolumeName = (serviceId: string, volIndex: number, newName: string, isNew: boolean) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? {
        ...s,
        volumes: s.volumes.map((v, i) => i === volIndex ? { ...v, name: newName, isNew } : v)
      } : s
    ));
    setShowVolumeMenu(null);
  };

  const handleUpdateBuildContext = (serviceId: string, context: string) => {
    setServices(prev => prev.map(s =>
      s.id === serviceId ? { ...s, buildContext: context } : s
    ));
  };

  const handleUpdateDockerfile = (serviceId: string, dockerfile: string) => {
    setServices(prev => prev.map(s => {
      if (s.id !== serviceId) return s;
      // If selecting a dockerfile from our system (has .dockerfile extension),
      // automatically set context to ../dockerfiles
      const isSystemDockerfile = dockerfile.endsWith('.dockerfile');
      return {
        ...s,
        dockerfile,
        buildContext: isSystemDockerfile ? '../dockerfiles' : s.buildContext,
      };
    }));
    setShowDockerfileMenu(null);
  };

  const handleCopyYaml = async () => {
    await navigator.clipboard.writeText(generatedYaml);
    setCopiedYaml(true);
    setTimeout(() => setCopiedYaml(false), 2000);
  };

  const handleApply = () => {
    onApplyCompose(showYamlEditor ? yamlContent : generatedYaml);
    onClose();
  };

  const handleApplyYamlChanges = () => {
    // Re-parse the edited YAML
    try {
      YAML.parse(yamlContent); // Validate YAML
      // Apply changes directly - the parent will handle the content
      setShowYamlEditor(false);
    } catch (error) {
      console.error('Invalid YAML:', error);
    }
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

  // Get icon for service type
  const getServiceIcon = (service: ParsedService) => {
    if (service.type === 'build') return <FileCode className="h-4 w-4" />;
    if (service.libraryComponent) {
      return CATEGORY_ICONS[service.libraryComponent.category] || <Server className="h-4 w-4" />;
    }
    // Try to guess from image name
    const img = service.image?.toLowerCase() || '';
    if (img.includes('postgres') || img.includes('mysql') || img.includes('mongo')) return <Database className="h-4 w-4" />;
    if (img.includes('redis') || img.includes('memcache')) return <Zap className="h-4 w-4" />;
    if (img.includes('nginx') || img.includes('apache')) return <Globe className="h-4 w-4" />;
    return <Server className="h-4 w-4" />;
  };

  if (isLoading) {
    if (inline) {
      return (
        <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2">Loading...</span>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="flex items-center gap-2 text-[hsl(var(--text-muted))]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  // Main content component (shared between inline and modal)
  const mainContent = (
    <>
      {/* Header - only show in modal mode */}
      {!inline && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-sm font-semibold text-[hsl(var(--text-primary))]">Stack Builder</h2>
            <p className="text-[10px] text-[hsl(var(--text-muted))]">
              {services.length} service{services.length !== 1 ? 's' : ''} + dev container
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowYamlEditor(!showYamlEditor)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border transition-colors ${
                showYamlEditor
                  ? 'bg-[hsl(var(--cyan)/0.15)] border-[hsl(var(--cyan)/0.3)] text-[hsl(var(--cyan))]'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
              }`}
            >
              {showYamlEditor ? <Eye className="h-3.5 w-3.5" /> : <Code className="h-3.5 w-3.5" />}
              {showYamlEditor ? 'Visual' : 'YAML'}
            </button>
            <button
              onClick={handleCopyYaml}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            >
              {copiedYaml ? <Check className="h-3.5 w-3.5 text-[hsl(var(--green))]" /> : <Copy className="h-3.5 w-3.5" />}
              Copy
            </button>
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)]"
            >
              <Check className="h-3.5 w-3.5" />
              Apply
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
        <div className="flex-1 overflow-hidden flex">
          {showYamlEditor ? (
            /* YAML Editor View */
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-2 bg-[hsl(var(--bg-base))] border-b border-[hsl(var(--border))] text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider flex items-center justify-between">
                <span>docker-compose.yml</span>
                <button
                  onClick={handleApplyYamlChanges}
                  className="px-2 py-1 text-[10px] bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.2)] border border-[hsl(var(--green)/0.3)]"
                >
                  Parse Changes
                </button>
              </div>
              <textarea
                value={yamlContent}
                onChange={(e) => setYamlContent(e.target.value)}
                className="flex-1 p-4 bg-[hsl(var(--bg-base))] text-[hsl(var(--text-secondary))] font-mono text-xs leading-relaxed resize-none focus:outline-none"
                spellCheck={false}
              />
            </div>
          ) : (
            /* Visual Editor View */
            <div className="flex-1 overflow-auto p-4">
              {/* Dev Container */}
              {devContainer && (
                <div className="mb-4 p-3 bg-[hsl(var(--cyan)/0.05)] border border-[hsl(var(--cyan)/0.2)]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Code className="h-4 w-4 text-[hsl(var(--cyan))]" />
                      <span className="text-xs font-medium text-[hsl(var(--cyan))]">Dev Container</span>
                      <span className="text-[10px] text-[hsl(var(--text-muted))]">({devContainer.name})</span>
                    </div>
                    {/* Connect button - show when dev container is running */}
                    {devContainerInfo?.state === 'running' && onConnectToDevContainer && (
                      <button
                        onClick={() => onConnectToDevContainer(devContainerInfo.containerId, devContainerInfo.serviceName)}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.25)] border border-[hsl(var(--cyan)/0.3)]"
                        title="Open terminal"
                      >
                        <TerminalSquare className="h-3.5 w-3.5" />
                        Connect
                      </button>
                    )}
                  </div>
                  {/* Image selector */}
                  <div className="flex items-center gap-2 relative">
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">Image:</span>
                    <button
                      onClick={() => setShowDevContainerDropdown(!showDevContainerDropdown)}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] hover:border-[hsl(var(--cyan)/0.5)]"
                    >
                      <span className="truncate max-w-[200px]">{(devContainer.config.image as string) || 'custom'}</span>
                      <ChevronDown className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                    </button>

                    {/* Dropdown */}
                    {showDevContainerDropdown && (
                      <div className="absolute left-0 top-full mt-1 z-20 w-64 max-h-48 overflow-auto bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg" onClick={e => e.stopPropagation()}>
                        <div className="px-2 py-1 text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider bg-[hsl(var(--bg-base))]">
                          Custom Images
                        </div>
                        {customImages.length > 0 ? (
                          customImages.map(img => (
                            <button
                              key={img}
                              onClick={() => handleUpdateDevContainerImage(img)}
                              className={`w-full px-2 py-1.5 text-left text-xs hover:bg-[hsl(var(--bg-overlay))] flex items-center gap-2 ${
                                devContainer.config.image === img ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]' : 'text-[hsl(var(--text-secondary))]'
                              }`}
                            >
                              {img}
                            </button>
                          ))
                        ) : (
                          <div className="px-2 py-2 text-xs text-[hsl(var(--text-muted))] italic">
                            No custom images found
                          </div>
                        )}
                        <div className="px-2 py-1 text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider bg-[hsl(var(--bg-base))] border-t border-[hsl(var(--border))]">
                          Common Images
                        </div>
                        {['ubuntu:24.04', 'ubuntu:22.04', 'debian:bookworm', 'node:20', 'python:3.12'].map(img => (
                          <button
                            key={img}
                            onClick={() => handleUpdateDevContainerImage(img)}
                            className={`w-full px-2 py-1.5 text-left text-xs hover:bg-[hsl(var(--bg-overlay))] ${
                              devContainer.config.image === img ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]' : 'text-[hsl(var(--text-secondary))]'
                            }`}
                          >
                            {img}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Add Service Buttons */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setShowComponentLibrary(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.2)] border border-[hsl(var(--green)/0.3)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add from Library
                </button>
                <button
                  onClick={handleAddBuildService}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.2)] border border-[hsl(var(--purple)/0.3)]"
                >
                  <FileCode className="h-3.5 w-3.5" />
                  Add Build Service
                </button>
              </div>

              {/* Services Grid */}
              {services.length === 0 ? (
                <div className="text-center py-12 text-[hsl(var(--text-muted))]">
                  <Server className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-xs">No services yet</p>
                  <p className="text-[10px] mt-1">Add services from the library or create a build service</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {services.map((service) => (
                    <div
                      key={service.id}
                      className={`p-3 border ${
                        service.type === 'build'
                          ? 'bg-[hsl(var(--purple)/0.05)] border-[hsl(var(--purple)/0.2)]'
                          : 'bg-[hsl(var(--bg-base))] border-[hsl(var(--border))]'
                      }`}
                    >
                      {/* Service Header */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className={service.type === 'build' ? 'text-[hsl(var(--purple))]' : 'text-[hsl(var(--cyan))]'}>
                            {getServiceIcon(service)}
                          </span>
                          <div>
                            {editingService === service.id ? (
                              <input
                                type="text"
                                value={service.name}
                                onChange={(e) => handleUpdateServiceName(service.id, e.target.value)}
                                onBlur={() => setEditingService(null)}
                                onKeyDown={(e) => e.key === 'Enter' && setEditingService(null)}
                                className="px-1 py-0.5 text-xs font-medium bg-[hsl(var(--input-bg))] border border-[hsl(var(--cyan))] text-[hsl(var(--text-primary))] w-32"
                                autoFocus
                              />
                            ) : (
                              <button
                                onClick={() => setEditingService(service.id)}
                                className="text-xs font-medium text-[hsl(var(--text-primary))] hover:text-[hsl(var(--cyan))]"
                              >
                                {service.name}
                              </button>
                            )}
                            <p className="text-[10px] text-[hsl(var(--text-muted))]">
                              {service.type === 'build' ? (
                                <span className="text-[hsl(var(--purple))]">build: {service.buildContext}</span>
                              ) : (
                                service.image || service.libraryComponent?.image
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveService(service.id)}
                          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Build Service: Context & Dockerfile */}
                      {service.type === 'build' && (
                        <div className="mb-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-[hsl(var(--text-muted))] w-16">Context:</label>
                            <input
                              type="text"
                              value={service.buildContext || ''}
                              onChange={(e) => handleUpdateBuildContext(service.id, e.target.value)}
                              placeholder="./"
                              className="flex-1 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                            />
                          </div>
                          <div className="flex items-center gap-2 relative">
                            <label className="text-[10px] text-[hsl(var(--text-muted))] w-16">Dockerfile:</label>
                            {(() => {
                              const status = getDockerfileStatus(service.dockerfile);
                              const isMissing = status === 'missing';
                              return (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDockerfileMenu(showDockerfileMenu === service.id ? null : service.id);
                                  }}
                                  className={`flex-1 flex items-center justify-between px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border text-[hsl(var(--text-primary))] hover:border-[hsl(var(--cyan)/0.5)] ${
                                    isMissing ? 'border-[hsl(var(--amber))]' : 'border-[hsl(var(--border))]'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    {isMissing && <AlertTriangle className="h-3 w-3 text-[hsl(var(--amber))]" />}
                                    {service.dockerfile || 'Dockerfile'}
                                  </span>
                                  <ChevronDown className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                                </button>
                              );
                            })()}

                            {/* Quick view/create button */}
                            {service.dockerfile && (
                              <button
                                onClick={() => handleViewDockerfile(service.dockerfile!, service.id)}
                                className={`p-1 hover:bg-[hsl(var(--bg-elevated))] ${
                                  getDockerfileStatus(service.dockerfile) === 'missing'
                                    ? 'text-[hsl(var(--amber))] hover:text-[hsl(var(--amber))]'
                                    : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]'
                                }`}
                                title={getDockerfileStatus(service.dockerfile) === 'missing' ? 'Create Dockerfile' : 'View Dockerfile'}
                              >
                                {getDockerfileStatus(service.dockerfile) === 'missing' ? <Plus className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            )}

                            {/* Upload button */}
                            <label className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] cursor-pointer" title="Upload Dockerfile">
                              <Upload className="h-3.5 w-3.5" />
                              <input
                                type="file"
                                onChange={(e) => handleDockerfileUpload(e, service.id)}
                                className="hidden"
                              />
                            </label>

                            {/* Dockerfile selector dropdown */}
                            {showDockerfileMenu === service.id && (
                              <div className="absolute left-16 top-full mt-1 z-20 w-64 max-h-48 overflow-auto bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg" onClick={e => e.stopPropagation()}>
                                <div className="px-2 py-1 text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider bg-[hsl(var(--bg-base))]">
                                  Available Dockerfiles
                                </div>
                                <button
                                  onClick={() => handleUpdateDockerfile(service.id, 'Dockerfile')}
                                  className="w-full px-2 py-1.5 text-left text-xs text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-overlay))]"
                                >
                                  Dockerfile (default)
                                </button>
                                {dockerfiles?.map(dfName => (
                                  <button
                                    key={dfName}
                                    onClick={() => handleUpdateDockerfile(service.id, dfName)}
                                    className={`w-full px-2 py-1.5 text-left text-xs hover:bg-[hsl(var(--bg-overlay))] flex items-center gap-2 ${
                                      service.dockerfile === dfName ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]' : 'text-[hsl(var(--text-secondary))]'
                                    }`}
                                  >
                                    <FileCode className="h-3 w-3" />
                                    {dfName}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Missing dockerfile warning */}
                          {getDockerfileStatus(service.dockerfile) === 'missing' && (
                            <div className="flex items-center gap-2 px-2 py-1.5 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)] text-[10px] text-[hsl(var(--amber))]">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span>Dockerfile not found. Click + to create it, or select an existing one from the dropdown.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Ports */}
                      <div className="mb-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Ports</span>
                          <button
                            onClick={() => handleAddPort(service.id)}
                            className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        {service.ports.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {service.ports.map((port, pi) => (
                              <div key={pi} className="flex items-center gap-1 text-[10px]">
                                <input
                                  type="number"
                                  value={port.host}
                                  onChange={(e) => handleUpdatePort(service.id, pi, 'host', parseInt(e.target.value) || 0)}
                                  className="w-14 px-1.5 py-0.5 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] text-center"
                                />
                                <span className="text-[hsl(var(--text-muted))]">:</span>
                                <span className="text-[hsl(var(--cyan))]">{port.container}</span>
                                <button
                                  onClick={() => handleRemovePort(service.id, pi)}
                                  className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-[hsl(var(--text-muted))] italic">No ports</span>
                        )}
                      </div>

                      {/* Volumes */}
                      {service.volumes.length > 0 && (
                        <div className="mb-2">
                          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Volumes</span>
                          <div className="mt-1 space-y-1">
                            {service.volumes.map((vol, vi) => (
                              <div key={vi} className="flex items-center gap-1.5 text-[10px]">
                                <div className="relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowVolumeMenu(
                                        showVolumeMenu?.serviceId === service.id && showVolumeMenu?.volIndex === vi
                                          ? null
                                          : { serviceId: service.id, volIndex: vi }
                                      );
                                    }}
                                    className={`px-1.5 py-0.5 text-left bg-[hsl(var(--input-bg))] border text-[hsl(var(--text-primary))] hover:border-[hsl(var(--cyan)/0.5)] flex items-center gap-1 ${
                                      vol.isNew ? 'border-[hsl(var(--green)/0.3)]' : 'border-[hsl(var(--border))]'
                                    }`}
                                  >
                                    <span className="truncate max-w-[100px]">{vol.name}</span>
                                    <ChevronDown className="h-2.5 w-2.5 text-[hsl(var(--text-muted))]" />
                                  </button>

                                  {/* Volume selector */}
                                  {showVolumeMenu?.serviceId === service.id && showVolumeMenu?.volIndex === vi && (
                                    <div className="absolute left-0 top-full mt-1 z-20 w-48 max-h-48 overflow-auto bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg" onClick={e => e.stopPropagation()}>
                                      <div className="px-2 py-1 text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider bg-[hsl(var(--bg-base))]">
                                        Create New
                                      </div>
                                      <button
                                        onClick={() => {
                                          const newName = `${service.name}_${vol.path.split('/').pop() || 'data'}`;
                                          handleUpdateVolumeName(service.id, vi, newName, true);
                                        }}
                                        className="w-full px-2 py-1.5 text-left text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-overlay))] flex items-center gap-1.5"
                                      >
                                        <Plus className="h-3 w-3" />
                                        New volume
                                      </button>
                                      {existingVolumeNames.length > 0 && (
                                        <>
                                          <div className="px-2 py-1 text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider bg-[hsl(var(--bg-base))] border-t border-[hsl(var(--border))]">
                                            Existing
                                          </div>
                                          {existingVolumeNames.map(volName => (
                                            <button
                                              key={volName}
                                              onClick={() => handleUpdateVolumeName(service.id, vi, volName, false)}
                                              className={`w-full px-2 py-1.5 text-left hover:bg-[hsl(var(--bg-overlay))] flex items-center gap-1.5 ${
                                                vol.name === volName ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]' : 'text-[hsl(var(--text-secondary))]'
                                              }`}
                                            >
                                              <HardDrive className="h-3 w-3" />
                                              {volName}
                                            </button>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <span className="text-[hsl(var(--text-muted))]">→</span>
                                <span className="text-[hsl(var(--cyan))] truncate">{vol.path}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Environment Variables */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Environment</span>
                          <button
                            onClick={() => handleAddEnvVar(service.id)}
                            className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        {Object.keys(service.environment).length > 0 ? (
                          <div className="space-y-1">
                            {Object.entries(service.environment).map(([key, value]) => (
                              <div key={key} className="flex items-center gap-1 text-[10px]">
                                <input
                                  type="text"
                                  value={key}
                                  onChange={(e) => handleRenameEnvVar(service.id, key, e.target.value)}
                                  className="w-28 px-1.5 py-0.5 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--amber))] font-mono"
                                  placeholder="KEY"
                                />
                                <span className="text-[hsl(var(--text-muted))]">=</span>
                                <input
                                  type="text"
                                  value={value}
                                  onChange={(e) => handleUpdateEnvVar(service.id, key, e.target.value)}
                                  className="flex-1 px-1.5 py-0.5 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] font-mono"
                                  placeholder="value"
                                />
                                <button
                                  onClick={() => handleRemoveEnvVar(service.id, key)}
                                  className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-[hsl(var(--text-muted))] italic">No environment variables</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
    </>
  );

  // Component Library Modal (shared between inline and modal)
  const componentLibraryModal = showComponentLibrary && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowComponentLibrary(false)}>
      <div className="w-full max-w-md mx-4 max-h-[80vh] flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Component Library</h3>
          <button
            onClick={() => setShowComponentLibrary(false)}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* AI Creator */}
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
              {createFromAI.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Categories */}
        <div className="flex-1 overflow-auto">
          {Object.entries(componentsByCategory).map(([category, categoryComponents]) => (
            <div key={category} className="border-b border-[hsl(var(--border))]">
              <button
                onClick={() => setExpandedCategory(expandedCategory === category ? null : category as Component['category'])}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))]"
              >
                <div className="flex items-center gap-2">
                  {CATEGORY_ICONS[category as Component['category']]}
                  <span>{CATEGORY_LABELS[category as Component['category']]}</span>
                  <span className="text-[hsl(var(--text-muted))]">({categoryComponents.length})</span>
                </div>
                {expandedCategory === category ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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
                            title="Add to stack"
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
    </div>
  );

  // Dockerfile viewer/editor modal
  const isNewDockerfile = viewingDockerfile?.content === '';
  const dockerfileViewerModal = viewingDockerfile && (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setViewingDockerfile(null)}>
      <div className="w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[hsl(var(--purple))]" />
            <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">{viewingDockerfile.name}.dockerfile</h3>
            {isNewDockerfile ? (
              <span className="text-[9px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">New</span>
            ) : dockerfileContent !== viewingDockerfile.content ? (
              <span className="text-[9px] px-1.5 py-0.5 bg-[hsl(var(--amber)/0.1)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.2)]">Modified</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveDockerfile}
              disabled={savingDockerfile || (!isNewDockerfile && dockerfileContent === viewingDockerfile.content)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
            >
              {savingDockerfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {isNewDockerfile ? 'Create' : 'Save'}
            </button>
            <button
              onClick={() => setViewingDockerfile(null)}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          <textarea
            value={dockerfileContent}
            onChange={(e) => setDockerfileContent(e.target.value)}
            className="w-full h-full p-4 bg-[hsl(var(--bg-base))] text-[hsl(var(--text-secondary))] font-mono text-xs leading-relaxed resize-none focus:outline-none"
            spellCheck={false}
            style={{ minHeight: '400px' }}
          />
        </div>

        {/* Footer with tips */}
        <div className="px-4 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <p className="text-[10px] text-[hsl(var(--text-muted))]">
            Use <code className="px-1 py-0.5 bg-[hsl(var(--bg-elevated))] rounded">{'{{PUBLIC_KEY}}'}</code> to inject SSH public key for dev containers
          </p>
        </div>
      </div>
    </div>
  );

  // Inline mode: return content directly without modal wrapper
  if (inline) {
    return (
      <div className="h-full flex flex-col bg-[hsl(var(--bg-surface))]" onClick={() => { setShowVolumeMenu(null); setShowDockerfileMenu(null); }}>
        {mainContent}
        {componentLibraryModal}
        {dockerfileViewerModal}
      </div>
    );
  }

  // Modal mode: wrap content in modal overlay
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => { setShowVolumeMenu(null); setShowDockerfileMenu(null); }}>
      <div className="w-full max-w-5xl mx-4 flex flex-col max-h-[90vh] bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        {mainContent}
      </div>
      {componentLibraryModal}
      {dockerfileViewerModal}
    </div>
  );
}
