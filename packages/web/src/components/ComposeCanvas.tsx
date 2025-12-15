import { useMemo, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import YAML from 'yaml';
import type { ComposeService } from '../api/client';
import { Database, Server, Globe, HardDrive, Box, MessageSquare, Zap, Code, Info } from 'lucide-react';

interface ComposeCanvasProps {
  composeContent: string;
  services: ComposeService[];
}

interface ParsedService {
  name: string;
  image?: string;
  ports?: Array<string | { target: number; published: number }>;
  depends_on?: string[] | Record<string, unknown>;
  links?: string[];
  volumes?: string[];
  environment?: Record<string, string> | string[];
}

// Helper: detect service type from name/image for icon selection
function getServiceType(name: string, image: string): { icon: React.ReactNode; category: string; color: string } {
  const combined = `${name} ${image}`.toLowerCase();

  // Databases
  if (combined.includes('postgres') || combined.includes('mysql') || combined.includes('mariadb') ||
      combined.includes('mongo') || combined.includes('cockroach') || combined.includes('sqlite')) {
    return { icon: <Database className="h-5 w-5" />, category: 'database', color: 'hsl(var(--cyan))' };
  }

  // Cache
  if (combined.includes('redis') || combined.includes('memcache') || combined.includes('valkey')) {
    return { icon: <Zap className="h-5 w-5" />, category: 'cache', color: 'hsl(var(--amber))' };
  }

  // Web servers / Load balancers
  if (combined.includes('nginx') || combined.includes('apache') || combined.includes('traefik') ||
      combined.includes('caddy') || combined.includes('haproxy')) {
    return { icon: <Globe className="h-5 w-5" />, category: 'web', color: 'hsl(var(--green))' };
  }

  // Message queues
  if (combined.includes('rabbit') || combined.includes('kafka') || combined.includes('nats') ||
      combined.includes('activemq') || combined.includes('pulsar')) {
    return { icon: <MessageSquare className="h-5 w-5" />, category: 'messaging', color: 'hsl(var(--purple))' };
  }

  // Storage
  if (combined.includes('minio') || combined.includes('s3') || combined.includes('storage')) {
    return { icon: <HardDrive className="h-5 w-5" />, category: 'storage', color: 'hsl(var(--text-muted))' };
  }

  // Dev containers
  if (combined.includes('dev') || combined.includes('node') || combined.includes('python') ||
      combined.includes('ubuntu') || combined.includes('debian') || combined.includes('acm-')) {
    return { icon: <Code className="h-5 w-5" />, category: 'development', color: 'hsl(var(--cyan))' };
  }

  return { icon: <Server className="h-5 w-5" />, category: 'service', color: 'hsl(var(--text-secondary))' };
}

// Custom node component
function ServiceNode({ data }: { data: { label: string; image: string; ports: string[]; status: 'running' | 'stopped' | 'unknown'; type: string; category: string; color: string } }) {
  const statusColor = data.status === 'running' ? 'bg-green-500' : data.status === 'stopped' ? 'bg-gray-400' : 'bg-yellow-500';
  const borderColor = data.status === 'running' ? 'border-green-500/50' : data.status === 'stopped' ? 'border-gray-400/50' : 'border-gray-300/50';

  return (
    <div className={`px-4 py-3 border-2 ${borderColor} bg-[hsl(var(--bg-surface))] shadow-lg min-w-[160px] rounded`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="font-semibold text-[hsl(var(--text-primary))]">{data.label}</span>
      </div>
      <div className="flex items-center gap-2 text-xs" style={{ color: data.color }}>
        {getServiceType(data.label, data.image).icon}
        <span className="truncate max-w-[120px] text-[hsl(var(--text-muted))]">{data.image || 'build'}</span>
      </div>
      {data.ports.length > 0 && (
        <div className="mt-2 text-xs text-[hsl(var(--cyan))]">
          {data.ports.join(', ')}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  service: ServiceNode,
};

export function ComposeCanvas({ composeContent, services }: ComposeCanvasProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    try {
      const parsed = YAML.parse(composeContent);
      const serviceEntries = Object.entries(parsed?.services || {}) as [string, ParsedService][];

      if (serviceEntries.length === 0) {
        return { nodes: [], edges: [] };
      }

      // Create a map of service statuses
      const statusMap = new Map<string, 'running' | 'stopped'>();
      for (const svc of services) {
        statusMap.set(svc.name, svc.state === 'running' ? 'running' : 'stopped');
      }

      // Calculate dependencies to determine layout
      const dependencyCount = new Map<string, number>();
      const dependents = new Map<string, string[]>();

      for (const [name] of serviceEntries) {
        dependencyCount.set(name, 0);
        dependents.set(name, []);
      }

      for (const [name, config] of serviceEntries) {
        const deps = Array.isArray(config.depends_on)
          ? config.depends_on
          : Object.keys(config.depends_on || {});

        for (const dep of deps) {
          dependencyCount.set(name, (dependencyCount.get(name) || 0) + 1);
          dependents.get(dep)?.push(name);
        }
      }

      // Sort services by dependency count (fewer deps = higher in layout)
      const sortedServices = [...serviceEntries].sort((a, b) => {
        return (dependencyCount.get(a[0]) || 0) - (dependencyCount.get(b[0]) || 0);
      });

      // Create nodes with auto-layout
      const nodes: Node[] = [];
      const edges: Edge[] = [];

      // Group services by their dependency level
      const levels: string[][] = [];
      const placed = new Set<string>();

      while (placed.size < serviceEntries.length) {
        const currentLevel: string[] = [];
        for (const [name] of sortedServices) {
          if (placed.has(name)) continue;

          const deps = Array.isArray(serviceEntries.find(([n]) => n === name)?.[1].depends_on)
            ? (serviceEntries.find(([n]) => n === name)?.[1].depends_on as string[])
            : Object.keys(serviceEntries.find(([n]) => n === name)?.[1].depends_on || {});

          const allDepsPlaced = deps.every(dep => placed.has(dep));
          if (allDepsPlaced || deps.length === 0) {
            currentLevel.push(name);
          }
        }

        if (currentLevel.length === 0) {
          // Break cycles by adding remaining services
          for (const [name] of sortedServices) {
            if (!placed.has(name)) {
              currentLevel.push(name);
              break;
            }
          }
        }

        for (const name of currentLevel) {
          placed.add(name);
        }
        levels.push(currentLevel);
      }

      // Position nodes
      const horizontalSpacing = 220;
      const verticalSpacing = 150;

      for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
        const level = levels[levelIdx];
        const totalWidth = (level.length - 1) * horizontalSpacing;
        const startX = -totalWidth / 2;

        for (let i = 0; i < level.length; i++) {
          const name = level[i];
          const config = serviceEntries.find(([n]) => n === name)?.[1];

          if (!config) continue;

          // Parse ports
          const ports: string[] = [];
          for (const port of config.ports || []) {
            if (typeof port === 'string') {
              ports.push(port);
            } else if (typeof port === 'object' && port.published) {
              ports.push(`${port.published}:${port.target}`);
            }
          }

          const serviceType = getServiceType(name, config.image || '');

          nodes.push({
            id: name,
            type: 'service',
            position: { x: startX + i * horizontalSpacing, y: levelIdx * verticalSpacing },
            data: {
              label: name,
              image: config.image || 'build',
              ports,
              status: statusMap.get(name) || 'unknown',
              type: config.image || name,
              category: serviceType.category,
              color: serviceType.color,
            },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
          });

          // Create edges for dependencies
          const deps = Array.isArray(config.depends_on)
            ? config.depends_on
            : Object.keys(config.depends_on || {});

          for (const dep of deps) {
            edges.push({
              id: `${dep}-${name}`,
              source: dep,
              target: name,
              type: 'smoothstep',
              animated: statusMap.get(name) === 'running',
              style: { stroke: statusMap.get(name) === 'running' ? '#22c55e' : '#9ca3af', strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: statusMap.get(name) === 'running' ? '#22c55e' : '#9ca3af',
              },
              label: 'depends_on',
              labelStyle: { fontSize: 10, fill: '#6b7280' },
              labelBgStyle: { fill: 'hsl(var(--bg-base))', fillOpacity: 0.8 },
            });
          }

          // Create edges for links
          for (const link of config.links || []) {
            const linkName = link.split(':')[0];
            if (!edges.find(e => e.id === `${linkName}-${name}-link`)) {
              edges.push({
                id: `${linkName}-${name}-link`,
                source: linkName,
                target: name,
                type: 'smoothstep',
                style: { stroke: '#60a5fa', strokeDasharray: '5,5', strokeWidth: 2 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: '#60a5fa',
                },
                label: 'links',
                labelStyle: { fontSize: 10, fill: '#60a5fa' },
                labelBgStyle: { fill: 'hsl(var(--bg-base))', fillOpacity: 0.8 },
              });
            }
          }

          // Detect implicit connections from environment variables
          const serviceNames = serviceEntries.map(([n]) => n);
          const env = config.environment;
          if (env) {
            const envValues = Array.isArray(env)
              ? env.map(e => e.split('=')[1] || '')
              : Object.values(env);

            for (const value of envValues) {
              if (!value) continue;
              // Check if any service name appears in env value (e.g., postgres://postgres:5432)
              for (const svcName of serviceNames) {
                if (svcName !== name && value.toLowerCase().includes(svcName.toLowerCase())) {
                  // Don't duplicate if we already have a depends_on or link edge
                  const existingEdge = edges.find(e =>
                    (e.source === svcName && e.target === name) ||
                    (e.source === name && e.target === svcName)
                  );
                  if (!existingEdge) {
                    edges.push({
                      id: `${svcName}-${name}-env`,
                      source: svcName,
                      target: name,
                      type: 'smoothstep',
                      style: { stroke: '#f59e0b', strokeDasharray: '3,3', strokeWidth: 1.5 },
                      markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: '#f59e0b',
                      },
                      label: 'env ref',
                      labelStyle: { fontSize: 9, fill: '#f59e0b' },
                      labelBgStyle: { fill: 'hsl(var(--bg-base))', fillOpacity: 0.8 },
                    });
                  }
                }
              }
            }
          }
        }
      }

      return { nodes, edges };
    } catch (error) {
      console.error('Failed to parse compose YAML:', error);
      return { nodes: [], edges: [] };
    }
  }, [composeContent, services]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when initialNodes change
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  if (initialNodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-base))]">
        <div className="text-center">
          <Box className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No services defined in compose file</p>
          <p className="text-sm mt-1">Add services to see the visualization</p>
        </div>
      </div>
    );
  }

  const [showLegend, setShowLegend] = useState(true);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        className="bg-[hsl(var(--bg-base))]"
        proOptions={{ hideAttribution: true }}
      >
        <Background className="!stroke-[hsl(var(--border))]" gap={20} />
        <Controls className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]" />

        {/* Legend Panel */}
        <Panel position="top-right" className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg">
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
          >
            <Info className="h-3.5 w-3.5" />
            {showLegend ? 'Hide Legend' : 'Legend'}
          </button>
          {showLegend && (
            <div className="px-3 pb-3 pt-1 border-t border-[hsl(var(--border))] space-y-2">
              <div className="text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">Connections</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-8 h-0.5 bg-green-500"></div>
                  <span className="text-[hsl(var(--text-secondary))]">depends_on (running)</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-8 h-0.5 bg-gray-400"></div>
                  <span className="text-[hsl(var(--text-secondary))]">depends_on (stopped)</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-8 h-0.5 border-t-2 border-dashed border-blue-400"></div>
                  <span className="text-[hsl(var(--text-secondary))]">links</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-8 h-0.5 border-t border-dashed border-amber-500"></div>
                  <span className="text-[hsl(var(--text-secondary))]">env reference</span>
                </div>
              </div>
              <div className="text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider pt-2">Status</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-[hsl(var(--text-secondary))]">Running</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                  <span className="text-[hsl(var(--text-secondary))]">Stopped</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                  <span className="text-[hsl(var(--text-secondary))]">Unknown</span>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}
