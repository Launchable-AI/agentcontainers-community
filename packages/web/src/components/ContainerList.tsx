import { useContainers } from '../hooks/useContainers';
import { ContainerCard } from './ContainerCard';
import { Loader2, Container, Plus } from 'lucide-react';

interface ContainerListProps {
  onCreateClick: () => void;
}

export function ContainerList({ onCreateClick }: ContainerListProps) {
  const { data: containers, isLoading, error } = useContainers();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 p-3 border border-[hsl(var(--red)/0.3)] bg-[hsl(var(--red)/0.1)] text-[hsl(var(--red))] text-xs">
        Failed to load containers: {error.message}
      </div>
    );
  }

  if (!containers || containers.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <button
            onClick={onCreateClick}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
            0 containers
          </span>
        </div>
        {/* Empty State */}
        <div className="flex-1 flex items-center justify-center text-[hsl(var(--text-muted))]">
          <div className="text-center">
            <Container className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-xs uppercase tracking-wider">No containers yet</p>
            <p className="text-[10px] mt-1 text-[hsl(var(--text-muted))]">Create one to get started</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <button
          onClick={onCreateClick}
          className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
        <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
          {containers.length} containers
        </span>
      </div>
      {/* Container Grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {containers.map((container) => (
            <ContainerCard key={container.id} container={container} />
          ))}
        </div>
      </div>
    </div>
  );
}
