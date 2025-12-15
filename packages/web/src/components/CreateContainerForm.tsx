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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="w-full max-w-lg bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-6 shadow-lg animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[hsl(var(--text-primary))]">
            Create Container
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
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
              className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)]"
            />
          </div>

          {/* Image */}
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
              Image
            </label>
            <select
              value={selectedImage}
              onChange={(e) => setImage(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)]"
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
            <p className="mt-1.5 text-[10px] text-[hsl(var(--text-muted))]">
              Built images launch instantly. Base images require a one-time build.
            </p>
          </div>

          {/* Volumes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider">
                Attach Volumes (mounted to ~/workspace)
              </label>
              {!isCreatingVolume && (
                <button
                  type="button"
                  onClick={startVolumeCreation}
                  className="flex items-center gap-1 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]"
                >
                  <Plus className="h-3 w-3" />
                  New Volume
                </button>
              )}
            </div>

            <div className="space-y-2 border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] p-3 max-h-48 overflow-y-auto">
              {/* Inline volume creation */}
              {isCreatingVolume && (
                <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[hsl(var(--border))]">
                  <HardDrive className="h-4 w-4 text-[hsl(var(--text-muted))] flex-shrink-0" />
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
                    className="flex-1 text-xs px-2 py-1 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={confirmVolumeCreation}
                    disabled={!newVolumeName.trim() || createVolumeMutation.isPending}
                    className="p-1 text-[hsl(var(--green))] hover:text-[hsl(var(--green-dim))] disabled:opacity-50"
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
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))] disabled:opacity-50"
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Volume creation error */}
              {createVolumeMutation.error && (
                <div className="text-[10px] text-[hsl(var(--red))] pb-2">
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
                      className="flex items-center gap-3 cursor-pointer group"
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
                        className="h-4 w-4 rounded border-[hsl(var(--border))] bg-[hsl(var(--input-bg))] text-[hsl(var(--cyan))] focus:ring-[hsl(var(--cyan))]"
                      />
                      <span className="text-xs text-[hsl(var(--text-secondary))] group-hover:text-[hsl(var(--text-primary))]">
                        {vol.name}
                      </span>
                    </label>
                  );
                })
              ) : !isCreatingVolume ? (
                <p className="text-xs text-[hsl(var(--text-muted))]">
                  No volumes yet. Click "New Volume" to create one.
                </p>
              ) : null}
            </div>
          </div>

          {/* Port Mapping */}
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
              Port Mapping (for web apps, APIs, etc.)
            </label>

            {ports.length > 0 && (
              <ul className="mb-2 space-y-1">
                {ports.map((port, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between bg-[hsl(var(--bg-elevated))] px-3 py-1.5 text-xs"
                  >
                    <span className="text-[hsl(var(--text-secondary))]">
                      localhost:{port.host} <span className="text-[hsl(var(--text-muted))]">→</span> container:{port.container}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePort(i)}
                      className="text-[hsl(var(--red))] hover:text-[hsl(var(--red-dim))]"
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
                className="w-24 px-2 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
              />
              <span className="text-[hsl(var(--text-muted))]">→</span>
              <input
                type="number"
                value={newContainerPort}
                onChange={(e) => setNewContainerPort(e.target.value)}
                placeholder="Container port"
                min="1"
                max="65535"
                className="w-28 px-2 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
              />
              <button
                type="button"
                onClick={addPort}
                disabled={!newHostPort || !newContainerPort}
                className="p-1.5 bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-[hsl(var(--text-muted))]">
              SSH port (22) is automatically mapped. Remove defaults if not needed.
            </p>
          </div>

          {/* Error message */}
          {createMutation.error && (
            <div className="p-3 text-xs bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-[hsl(var(--red))]">
              {createMutation.error.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !name}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[hsl(var(--cyan))] text-white hover:bg-[hsl(var(--cyan-dim))] disabled:opacity-50 transition-colors"
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
