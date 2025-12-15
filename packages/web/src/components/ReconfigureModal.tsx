import { useState } from 'react';
import { X, Loader2, Plus, Settings } from 'lucide-react';
import { useReconfigureContainer, useVolumes } from '../hooks/useContainers';
import type { ContainerInfo } from '../api/client';

interface ReconfigureModalProps {
  container: ContainerInfo;
  onClose: () => void;
}

export function ReconfigureModal({ container, onClose }: ReconfigureModalProps) {
  const [selectedVolumes, setSelectedVolumes] = useState<
    Array<{ name: string; mountPath: string }>
  >(container.volumes);
  const [ports, setPorts] = useState<Array<{ container: number; host: number }>>(
    container.ports
  );
  const [newContainerPort, setNewContainerPort] = useState('');
  const [newHostPort, setNewHostPort] = useState('');

  const reconfigureMutation = useReconfigureContainer();
  const { data: volumes } = useVolumes();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await reconfigureMutation.mutateAsync({
        id: container.id,
        volumes: selectedVolumes.length > 0 ? selectedVolumes : undefined,
        ports: ports.length > 0 ? ports : undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to reconfigure container:', error);
    }
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="w-full max-w-lg bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-6 shadow-lg animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[hsl(var(--text-primary))] flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Reconfigure Container
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 p-3 text-xs bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] text-[hsl(var(--amber))]">
          This will recreate the container with new settings. The container will be stopped and restarted with a new SSH port.
        </div>

        <div className="mb-4 text-xs text-[hsl(var(--text-secondary))] space-y-1">
          <p><span className="text-[hsl(var(--text-muted))] uppercase tracking-wider">Container:</span> {container.name}</p>
          <p><span className="text-[hsl(var(--text-muted))] uppercase tracking-wider">Image:</span> {container.image}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Volumes */}
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
              Volumes (mounted to ~/workspace)
            </label>

            {volumes && volumes.length > 0 ? (
              <div className="space-y-2 border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] p-3 max-h-40 overflow-y-auto">
                {volumes.map((vol) => {
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
                })}
              </div>
            ) : (
              <p className="text-xs text-[hsl(var(--text-muted))]">
                No volumes available.
              </p>
            )}
          </div>

          {/* Port Mapping */}
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
              Port Mapping
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
                placeholder="Host port"
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
              SSH port (22) is automatically mapped to a new random port
            </p>
          </div>

          {/* Error message */}
          {reconfigureMutation.error && (
            <div className="p-3 text-xs bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-[hsl(var(--red))]">
              {reconfigureMutation.error.message}
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
              disabled={reconfigureMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[hsl(var(--cyan))] text-white hover:bg-[hsl(var(--cyan-dim))] disabled:opacity-50 transition-colors"
            >
              {reconfigureMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Reconfigure
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
