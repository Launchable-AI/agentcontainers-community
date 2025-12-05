import { useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import YAML from 'yaml';
import type { ComposeService } from '../api/client';
import { Database, Server, Globe, HardDrive, Box } from 'lucide-react';

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

// Custom node component
function ServiceNode({ data }: { data: { label: string; image: string; ports: string[]; status: 'running' | 'stopped' | 'unknown'; type: string } }) {
  const getIcon = () => {
    const type = data.type.toLowerCase();
    if (type.includes('postgres') || type.includes('mysql') || type.includes('mongo') || type.includes('redis') || type.includes('mariadb')) {
      return <Database className="h-5 w-5" />;
    }
    if (type.includes('nginx') || type.includes('apache') || type.includes('traefik') || type.includes('caddy')) {
      return <Globe className="h-5 w-5" />;
    }
    if (type.includes('volume') || type.includes('storage')) {
      return <HardDrive className="h-5 w-5" />;
    }
    return <Server className="h-5 w-5" />;
  };

  const statusColor = data.status === 'running' ? 'bg-green-500' : data.status === 'stopped' ? 'bg-gray-400' : 'bg-yellow-500';
  const borderColor = data.status === 'running' ? 'border-green-500' : data.status === 'stopped' ? 'border-gray-400' : 'border-gray-300';

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${borderColor} bg-white dark:bg-gray-800 shadow-lg min-w-[160px]`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="font-semibold text-gray-900 dark:text-white">{data.label}</span>
      </div>
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs">
        {getIcon()}
        <span className="truncate max-w-[120px]">{data.image || 'no image'}</span>
      </div>
      {data.ports.length > 0 && (
        <div className="mt-2 text-xs text-blue-600 dark:text-blue-400">
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
              style: { stroke: statusMap.get(name) === 'running' ? '#22c55e' : '#9ca3af' },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: statusMap.get(name) === 'running' ? '#22c55e' : '#9ca3af',
              },
              label: 'depends_on',
              labelStyle: { fontSize: 10, fill: '#6b7280' },
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
                style: { stroke: '#60a5fa', strokeDasharray: '5,5' },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: '#60a5fa',
                },
                label: 'links',
                labelStyle: { fontSize: 10, fill: '#60a5fa' },
              });
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
      <div className="h-full flex items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <Box className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No services defined in compose file</p>
          <p className="text-sm mt-1">Add services to see the visualization</p>
        </div>
      </div>
    );
  }

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
        className="bg-gray-50 dark:bg-gray-900"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls className="bg-white dark:bg-gray-800 border dark:border-gray-700" />
      </ReactFlow>
    </div>
  );
}
