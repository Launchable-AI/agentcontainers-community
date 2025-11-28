import { useContainers } from '../hooks/useContainers';
import { ContainerCard } from './ContainerCard';
import { Loader2, Box } from 'lucide-react';

export function ContainerList() {
  const { data: containers, isLoading, error } = useContainers();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
        Failed to load containers: {error.message}
      </div>
    );
  }

  if (!containers || containers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Box className="h-12 w-12 mb-4" />
        <p>No containers yet</p>
        <p className="text-sm">Create one to get started</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {containers.map((container) => (
        <ContainerCard key={container.id} container={container} />
      ))}
    </div>
  );
}
