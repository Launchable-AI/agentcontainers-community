import { useState } from 'react';
import { Plus, Server, AlertTriangle, Terminal, Play, Square, Trash2, Copy, Download, Cpu, MemoryStick, HardDrive, Network, Loader2 } from 'lucide-react';
import { useVms, useStartVm, useStopVm, useDeleteVm, useVmNetworkStatus, useCreateVm, useVmBaseImages } from '../hooks/useContainers';
import { VmInfo, downloadVmSshKey } from '../api/client';
import { useConfirm } from './ConfirmModal';

interface VMListProps {
  onCreateClick: () => void;
}

function VMCard({ vm }: { vm: VmInfo }) {
  const startVm = useStartVm();
  const stopVm = useStopVm();
  const deleteVm = useDeleteVm();
  const confirm = useConfirm();
  const [showLogs, setShowLogs] = useState(false);

  const isRunning = vm.status === 'running';
  const isBooting = vm.status === 'booting' || vm.status === 'creating';
  const hasError = vm.status === 'error';

  const statusColors: Record<string, string> = {
    running: 'bg-[hsl(var(--green))]',
    booting: 'bg-[hsl(var(--yellow))]',
    creating: 'bg-[hsl(var(--yellow))]',
    stopped: 'bg-[hsl(var(--text-muted))]',
    paused: 'bg-[hsl(var(--cyan))]',
    error: 'bg-[hsl(var(--red))]',
  };

  const handleStart = () => {
    startVm.mutate(vm.id);
  };

  const handleStop = () => {
    stopVm.mutate(vm.id);
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete VM',
      message: `Are you sure you want to delete "${vm.name}"? This will delete all VM data including disk images.`,
      confirmText: 'Delete',
      danger: true,
    });

    if (confirmed) {
      deleteVm.mutate(vm.id);
    }
  };

  const copySshCommand = () => {
    if (vm.sshCommand) {
      navigator.clipboard.writeText(vm.sshCommand);
    }
  };

  const downloadSshKey = async () => {
    try {
      const blob = await downloadVmSshKey();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vm_id_ed25519';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download SSH key:', error);
    }
  };

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-4 hover:border-[hsl(var(--cyan)/0.3)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColors[vm.status] || statusColors.stopped}`} />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">{vm.name}</h3>
        </div>
        <span className="text-[10px] font-mono text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-elevated))] px-1.5 py-0.5">
          {vm.status.toUpperCase()}
        </span>
      </div>

      {/* Resources */}
      <div className="flex gap-3 mb-3 text-[10px] text-[hsl(var(--text-muted))]">
        <div className="flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          {vm.vcpus} vCPU
        </div>
        <div className="flex items-center gap-1">
          <MemoryStick className="h-3 w-3" />
          {vm.memoryMb} MB
        </div>
        <div className="flex items-center gap-1">
          <HardDrive className="h-3 w-3" />
          {vm.diskGb} GB
        </div>
      </div>

      {/* Image */}
      <div className="text-[10px] text-[hsl(var(--text-muted))] mb-3 truncate" title={vm.image}>
        Image: {vm.image}
      </div>

      {/* Network Info */}
      {vm.guestIp && (
        <div className="text-[10px] text-[hsl(var(--text-muted))] mb-3 flex items-center gap-1">
          <Network className="h-3 w-3" />
          {vm.guestIp} ({vm.networkMode})
        </div>
      )}

      {/* Error */}
      {hasError && vm.error && (
        <div className="text-[10px] text-[hsl(var(--red))] mb-3 bg-[hsl(var(--red)/0.1)] p-2 border border-[hsl(var(--red)/0.3)]">
          {vm.error}
        </div>
      )}

      {/* SSH Command */}
      {isRunning && vm.sshCommand && (
        <div className="mb-3">
          <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] mb-1">
            <Terminal className="h-3 w-3" />
            SSH Command
          </div>
          <div className="flex items-center gap-1">
            <code className="flex-1 text-[10px] bg-[hsl(var(--bg-base))] text-[hsl(var(--cyan))] px-2 py-1 font-mono truncate">
              {vm.sshCommand}
            </code>
            <button
              onClick={copySshCommand}
              className="p-1 hover:bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              title="Copy SSH command"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-[hsl(var(--border))]">
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={stopVm.isPending}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--yellow))] hover:bg-[hsl(var(--yellow)/0.1)] border border-[hsl(var(--yellow)/0.3)] disabled:opacity-50"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={startVm.isPending || isBooting}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
          >
            {isBooting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="h-3 w-3" />
                Start
              </>
            )}
          </button>
        )}

        <button
          onClick={downloadSshKey}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]"
          title="Download SSH key"
        >
          <Download className="h-3 w-3" />
          Key
        </button>

        <div className="flex-1" />

        <button
          onClick={handleDelete}
          disabled={deleteVm.isPending || isRunning}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
          title={isRunning ? 'Stop VM before deleting' : 'Delete VM'}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function CreateVMForm({ onClose }: { onClose: () => void }) {
  const createVm = useCreateVm();
  const { data: baseImages } = useVmBaseImages();
  const [name, setName] = useState('');
  const [baseImage, setBaseImage] = useState('');
  const [vcpus, setVcpus] = useState(1);
  const [memoryMb, setMemoryMb] = useState(1024);
  const [diskGb, setDiskGb] = useState(5);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createVm.mutateAsync({
        name,
        baseImage: baseImage || undefined,
        vcpus,
        memoryMb,
        diskGb,
        autoStart: true,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create VM:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4">Create Virtual Machine</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="my-vm"
              required
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
            />
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Base Image</label>
            <select
              value={baseImage}
              onChange={e => setBaseImage(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
            >
              <option value="">Default (ubuntu-24.04)</option>
              {baseImages?.map(img => (
                <option key={img.name} value={img.name}>
                  {img.name} {img.hasWarmupSnapshot ? '(fast boot)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">vCPUs</label>
              <input
                type="number"
                value={vcpus}
                onChange={e => setVcpus(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                min={1}
                max={32}
              />
            </div>
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Memory (MB)</label>
              <input
                type="number"
                value={memoryMb}
                onChange={e => setMemoryMb(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                min={512}
                max={65536}
                step={256}
              />
            </div>
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Disk (GB)</label>
              <input
                type="number"
                value={diskGb}
                onChange={e => setDiskGb(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                min={1}
                max={1000}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createVm.isPending || !name}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)] hover:bg-[hsl(var(--cyan)/0.1)] disabled:opacity-50"
            >
              {createVm.isPending ? 'Creating...' : 'Create VM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function VMList({ onCreateClick }: VMListProps) {
  const { data: vms, isLoading, error } = useVms();
  const { data: networkStatus } = useVmNetworkStatus();
  const [showCreateForm, setShowCreateForm] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--text-muted))]">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading VMs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--red))]">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Failed to load VMs: {String(error)}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Network Status Warning */}
      {networkStatus && !networkStatus.healthy && (
        <div className="mb-4 p-3 bg-[hsl(var(--yellow)/0.1)] border border-[hsl(var(--yellow)/0.3)] text-[hsl(var(--yellow))]">
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <AlertTriangle className="h-4 w-4" />
            Network Not Configured
          </div>
          <p className="text-xs text-[hsl(var(--text-muted))]">
            {networkStatus.message}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[hsl(var(--text-muted))]">
            {vms?.length || 0} VM{(vms?.length || 0) !== 1 ? 's' : ''}
          </span>
          {networkStatus?.healthy && (
            <span className="text-[10px] text-[hsl(var(--green))] bg-[hsl(var(--green)/0.1)] px-2 py-0.5 border border-[hsl(var(--green)/0.3)]">
              Network: {networkStatus.availableTaps} TAPs available
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New VM
        </button>
      </div>

      {/* VM Grid */}
      {vms && vms.length > 0 ? (
        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
          {vms.map(vm => (
            <VMCard key={vm.id} vm={vm} />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-[hsl(var(--text-muted))]">
          <Server className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm mb-1">No virtual machines</p>
          <p className="text-xs mb-4">Create a VM to get started with cloud-hypervisor</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Create VM
          </button>
        </div>
      )}

      {/* Create VM Modal */}
      {showCreateForm && (
        <CreateVMForm onClose={() => setShowCreateForm(false)} />
      )}
    </div>
  );
}
