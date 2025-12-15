import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import * as api from '../api/client';

export function useContainers() {
  // Pause polling while container state mutations are in flight
  const isMutatingContainers = useIsMutating({ mutationKey: ['container-state'] });

  return useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
    refetchInterval: isMutatingContainers > 0 ? false : 5000,
  });
}

export function useContainer(id: string) {
  return useQuery({
    queryKey: ['containers', id],
    queryFn: () => api.getContainer(id),
  });
}

export function useCreateContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createContainer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useStartContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['container-state'],
    mutationFn: api.startContainer,
    onMutate: async (containerId) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['containers'] });

      // Snapshot the previous value
      const previousContainers = queryClient.getQueryData<api.ContainerInfo[]>(['containers']);

      // Optimistically update to the new value
      if (previousContainers) {
        queryClient.setQueryData<api.ContainerInfo[]>(['containers'],
          previousContainers.map(c =>
            c.id === containerId
              ? { ...c, state: 'running' as const }
              : c
          )
        );
      }

      // Return context with the previous value
      return { previousContainers };
    },
    onError: (_err, _containerId, context) => {
      // Rollback to previous value on error
      if (context?.previousContainers) {
        queryClient.setQueryData(['containers'], context.previousContainers);
      }
      // Only refetch on error to get actual state
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
    // On success, keep the optimistic state - polling will sync eventually
  });
}

export function useStopContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['container-state'],
    mutationFn: api.stopContainer,
    onMutate: async (containerId) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['containers'] });

      // Snapshot the previous value
      const previousContainers = queryClient.getQueryData<api.ContainerInfo[]>(['containers']);

      // Optimistically update to the new value
      if (previousContainers) {
        queryClient.setQueryData<api.ContainerInfo[]>(['containers'],
          previousContainers.map(c =>
            c.id === containerId
              ? { ...c, state: 'exited' as const }
              : c
          )
        );
      }

      // Return context with the previous value
      return { previousContainers };
    },
    onError: (_err, _containerId, context) => {
      // Rollback to previous value on error
      if (context?.previousContainers) {
        queryClient.setQueryData(['containers'], context.previousContainers);
      }
      // Only refetch on error to get actual state
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
    // On success, keep the optimistic state - polling will sync eventually
  });
}

export function useRemoveContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.removeContainer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useReconfigureContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...request }: { id: string } & api.ReconfigureContainerRequest) =>
      api.reconfigureContainer(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useImages() {
  return useQuery({
    queryKey: ['images'],
    queryFn: api.listImages,
  });
}

export function usePullImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.pullImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

export function useVolumes() {
  return useQuery({
    queryKey: ['volumes'],
    queryFn: api.listVolumes,
  });
}

export function useCreateVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createVolume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] });
    },
  });
}

export function useRemoveVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.removeVolume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] });
    },
  });
}

export function useDockerfiles() {
  return useQuery({
    queryKey: ['dockerfiles'],
    queryFn: api.listDockerfiles,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.checkHealth,
    refetchInterval: 10000,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

// Compose hooks
export function useComposeProjects() {
  return useQuery({
    queryKey: ['composes'],
    queryFn: api.listComposeProjects,
    refetchInterval: 5000,
  });
}

export function useComposeProject(name: string) {
  return useQuery({
    queryKey: ['composes', name],
    queryFn: () => api.getComposeProject(name),
    enabled: !!name,
  });
}

export function useComposeContent(name: string) {
  return useQuery({
    queryKey: ['composes', name, 'content'],
    queryFn: () => api.getComposeContent(name),
    enabled: !!name,
  });
}

export function useCreateCompose() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.createComposeProject(name, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['composes'] });
    },
  });
}

export function useUpdateCompose() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.updateComposeProject(name, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['composes'] });
    },
  });
}

export function useDeleteCompose() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteComposeProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['composes'] });
    },
  });
}

export function useRenameCompose() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, newName }: { name: string; newName: string }) =>
      api.renameComposeProject(name, newName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['composes'] });
    },
  });
}

// Component hooks
export function useComponents() {
  return useQuery({
    queryKey: ['components'],
    queryFn: api.listComponents,
  });
}

export function useComponent(id: string) {
  return useQuery({
    queryKey: ['components', id],
    queryFn: () => api.getComponent(id),
    enabled: !!id,
  });
}

export function useCreateComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createComponent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['components'] });
    },
  });
}

export function useDeleteComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteComponent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['components'] });
    },
  });
}

export function useCreateComponentFromAI() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createComponentFromAI,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['components'] });
    },
  });
}
