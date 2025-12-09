import { useState, useMemo, useRef, useEffect } from 'react';
import { X, Loader2, Plus, Check, HardDrive } from 'lucide-react';
import { useCreateContainer, useVolumes, useImages, useContainers, useConfig, useCreateVolume } from '../hooks/useContainers';

interface CreateContainerFormProps {
  onClose: () => void;
}

// Generate a random suffix for volume names
function generateRandomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

export function CreateContainerForm({ onClose }: CreateContainerFormProps) {
  const createMutation = useCreateContainer();
  const createVolumeMutation = useCreateVolume();
  const { data: volumes } = useVolumes();
  const { data: images } = useImages();
  const { data: containers } = useContainers();
  const { data: config } = useConfig();

  // Inline volume creation state
  const [isCreatingVolume, setIsCreatingVolume] = useState(false);
  const [newVolumeName, setNewVolumeName] = useState('');
  const newVolumeInputRef = useRef<HTMLInputElement>(null);

  // Calculate ports already in use by existing containers
  const usedHostPorts = useMemo(() => {
    const ports = new Set<number>();
    if (containers) {
      for (const container of containers) {
        // Add the SSH port
        if (container.sshPort) {
          ports.add(container.sshPort);
        }
        // Add all mapped ports
        for (const port of container.ports || []) {
          ports.add(port.host);
        }
      }
    }
    return ports;
  }, [containers]);

  // Find the next available host port starting from startPort, going down
  const findNextAvailablePort = (startPort: number, excludePorts: Set<number> = new Set()): number => {
    const allUsed = new Set([...usedHostPorts, ...excludePorts]);
    let port = startPort;
    while (allUsed.has(port) && port > 1024) {
      port--;
    }
    return port;
  };

  // Calculate dynamic default ports
  const defaultPort1 = useMemo(() => findNextAvailablePort(9999), [usedHostPorts]);
  const defaultPort2 = useMemo(() => findNextAvailablePort(9998, new Set([defaultPort1])), [usedHostPorts, defaultPort1]);

  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [selectedVolumes, setSelectedVolumes] = useState<
    Array<{ name: string; mountPath: string }>
  >([]);
  // Default port mappings: common dev server ports (dynamically calculated)
  const [ports, setPorts] = useState<Array<{ container: number; host: number }>>([
    { host: defaultPort1, container: 3000 },  // Node.js/Express
    { host: defaultPort2, container: 5173 },  // Vite dev server
  ]);
  const [newContainerPort, setNewContainerPort] = useState('');
  const [newHostPort, setNewHostPort] = useState('');

  // Use config default image if set, otherwise fall back to first available image or ubuntu
  const fallbackImage = images?.flatMap((i) => i.repoTags).find((tag) => tag && tag !== '<none>:<none>') || 'ubuntu:24.04';
  const defaultImage = config?.defaultDevNodeImage || fallbackImage;
  const selectedImage = image || defaultImage;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createMutation.mutateAsync({
        name,
        image: selectedImage,
        volumes: selectedVolumes.length > 0 ? selectedVolumes : undefined,
        ports: ports.length > 0 ? ports : undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create container:', error);
    }
  };

  // Get next available host port counting down from 9999
  // Considers both current form ports and ports used by existing containers
  const getNextHostPort = () => {
    const formPorts = new Set(ports.map(p => p.host));
    const allUsed = new Set([...usedHostPorts, ...formPorts]);
    let nextPort = 9999;
    while (allUsed.has(nextPort) && nextPort > 1024) {
      nextPort--;
    }
    return nextPort;
  };

  const addPort = () => {
    const containerPort = parseInt(newContainerPort, 10);
    const hostPort = parseInt(newHostPort, 10);
    if (containerPort && hostPort) {
      setPorts([...ports, { container: containerPort, host: hostPort }]);
      setNewContainerPort('');
      setNewHostPort('');
    }
  };

  const removePort = (index: number) => {
    setPorts(ports.filter((_, i) => i !== index));
  };

  // Start inline volume creation
  const startVolumeCreation = () => {
    const baseName = name.trim() || `volume-${generateRandomSuffix()}`;
    setNewVolumeName(baseName);
    setIsCreatingVolume(true);
  };

  // Focus the volume input when it appears
  useEffect(() => {
    if (isCreatingVolume && newVolumeInputRef.current) {
      newVolumeInputRef.current.focus();
      newVolumeInputRef.current.select();
    }
  }, [isCreatingVolume]);

  // Cancel inline volume creation
  const cancelVolumeCreation = () => {
    setIsCreatingVolume(false);
    setNewVolumeName('');
  };

  // Confirm and create the volume
  const confirmVolumeCreation = async () => {
    if (!newVolumeName.trim()) return;

    try {
      await createVolumeMutation.mutateAsync(newVolumeName.trim());
      // Auto-select the newly created volume
      setSelectedVolumes([
        ...selectedVolumes,
        { name: newVolumeName.trim(), mountPath: '/home/dev/workspace' },
      ]);
      setIsCreatingVolume(false);
      setNewVolumeName('');
    } catch (error) {
      console.error('Failed to create volume:', error);
    }
  };

  // Common base images
  const commonImages = [
    'ubuntu:24.04',
    'ubuntu:22.04',
    'debian:bookworm',
    'debian:bullseye',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold dark:text-white">
            Create Container
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Container Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent-env"
              required
              autoFocus
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Image */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Image
            </label>
            <select
              value={selectedImage}
              onChange={(e) => setImage(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              {images && images.length > 0 && (
                <optgroup label="Built Images (ready to use)">
                  {images
                    .flatMap((i) => i.repoTags)
                    .filter((tag) => tag && tag !== '<none>:<none>')
                    .map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="Base Images (will build with SSH setup)">
                {commonImages.map((img) => (
                  <option key={img} value={img}>
                    {img}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Built images launch instantly. Base images require a one-time build.
            </p>
          </div>

          {/* Volumes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Attach Volumes (mounted to ~/workspace)
              </label>
              {!isCreatingVolume && (
                <button
                  type="button"
                  onClick={startVolumeCreation}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <Plus className="h-3 w-3" />
                  New Volume
                </button>
              )}
            </div>

            <div className="space-y-2 rounded-md border border-gray-300 dark:border-gray-600 p-3">
              {/* Inline volume creation */}
              {isCreatingVolume && (
                <div className="flex items-center gap-2 pb-2 mb-2 border-b border-gray-200 dark:border-gray-600">
                  <HardDrive className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <input
                    ref={newVolumeInputRef}
                    type="text"
                    value={newVolumeName}
                    onChange={(e) => setNewVolumeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmVolumeCreation();
                      } else if (e.key === 'Escape') {
                        cancelVolumeCreation();
                      }
                    }}
                    placeholder="volume-name"
                    className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={confirmVolumeCreation}
                    disabled={!newVolumeName.trim() || createVolumeMutation.isPending}
                    className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                    title="Create volume"
                  >
                    {createVolumeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={cancelVolumeCreation}
                    disabled={createVolumeMutation.isPending}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Volume creation error */}
              {createVolumeMutation.error && (
                <div className="text-xs text-red-600 dark:text-red-400 pb-2">
                  {createVolumeMutation.error.message}
                </div>
              )}

              {/* Existing volumes */}
              {volumes && volumes.length > 0 ? (
                volumes.map((vol) => {
                  const isSelected = selectedVolumes.some((v) => v.name === vol.name);
                  return (
                    <label
                      key={vol.name}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedVolumes([
                              ...selectedVolumes,
                              { name: vol.name, mountPath: '/home/dev/workspace' },
                            ]);
                          } else {
                            setSelectedVolumes(
                              selectedVolumes.filter((v) => v.name !== vol.name)
                            );
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {vol.name}
                      </span>
                    </label>
                  );
                })
              ) : !isCreatingVolume ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No volumes yet. Click "New Volume" to create one.
                </p>
              ) : null}
            </div>
          </div>

          {/* Port Mapping */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Port Mapping (for web apps, APIs, etc.)
            </label>

            {ports.length > 0 && (
              <ul className="mb-2 space-y-1">
                {ports.map((port, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded bg-gray-100 px-3 py-1 text-sm dark:bg-gray-700"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      localhost:{port.host} → container:{port.container}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePort(i)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={newHostPort}
                onChange={(e) => setNewHostPort(e.target.value)}
                placeholder={String(getNextHostPort())}
                min="1"
                max="65535"
                className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <span className="text-gray-500">→</span>
              <input
                type="number"
                value={newContainerPort}
                onChange={(e) => setNewContainerPort(e.target.value)}
                placeholder="Container port"
                min="1"
                max="65535"
                className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <button
                type="button"
                onClick={addPort}
                disabled={!newHostPort || !newContainerPort}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              SSH port (22) is automatically mapped. Remove defaults if not needed.
            </p>
          </div>

          {/* Error message */}
          {createMutation.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {createMutation.error.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !name}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Create Container
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
