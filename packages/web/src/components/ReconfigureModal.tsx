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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold dark:text-white flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Reconfigure Container
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
          This will recreate the container with new settings. The container will be stopped and restarted with a new SSH port.
        </div>

        <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          <p><strong>Container:</strong> {container.name}</p>
          <p><strong>Image:</strong> {container.image}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Volumes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Volumes (mounted to ~/workspace)
            </label>

            {volumes && volumes.length > 0 ? (
              <div className="space-y-2 rounded-md border border-gray-300 dark:border-gray-600 p-3">
                {volumes.map((vol) => {
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
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No volumes available.
              </p>
            )}
          </div>

          {/* Port Mapping */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Port Mapping
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
                placeholder="Host port"
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
              SSH port (22) is automatically mapped to a new random port
            </p>
          </div>

          {/* Error message */}
          {reconfigureMutation.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {reconfigureMutation.error.message}
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
              disabled={reconfigureMutation.isPending}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
