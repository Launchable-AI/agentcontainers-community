import { useState, useRef, useEffect } from 'react';
import {
  HardDrive,
  Plus,
  Trash2,
  Download,
  Upload,
  Camera,
  Loader2,
  AlertTriangle,
  Check,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Terminal,
} from 'lucide-react';
import { useVmBaseImages, useVms, useDeleteVmBaseImage, useTriggerVmWarmup, useWarmupStatus, useClearWarmupStatus, useWarmupLogs } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';

type CreateMethod = 'import' | 'download' | 'snapshot';

interface BaseImageInfo {
  name: string;
  hasKernel: boolean;
  hasWarmupSnapshot: boolean;
}

function BaseImageCard({
  image,
  onDelete,
  onWarmup,
  isDeleting,
}: {
  image: BaseImageInfo;
  onDelete: () => void;
  onWarmup: () => void;
  isDeleting: boolean;
}) {
  const [showLogs, setShowLogs] = useState(true);
  const logContainerRef = useRef<HTMLPreElement>(null);

  // Poll warmup status
  const { data: warmupStatus } = useWarmupStatus(image.name);
  const clearWarmupStatus = useClearWarmupStatus();

  const isWarmingUp = warmupStatus &&
    warmupStatus.phase !== 'idle' &&
    warmupStatus.phase !== 'complete' &&
    warmupStatus.phase !== 'error';

  const hasError = warmupStatus?.phase === 'error';

  // Poll warmup logs when warming up
  const { data: logsData } = useWarmupLogs(image.name, isWarmingUp || false);

  const handleDismissError = () => {
    clearWarmupStatus.mutate(image.name);
  };

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current && showLogs) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logsData?.logs, showLogs]);

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-4 hover:border-[hsl(var(--cyan)/0.3)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-[hsl(var(--cyan))]" />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">{image.name}</h3>
        </div>
        {image.hasWarmupSnapshot && (
          <span className="text-[10px] bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] px-1.5 py-0.5 border border-[hsl(var(--green)/0.3)]">
            FAST BOOT
          </span>
        )}
      </div>

      {/* Warmup Progress */}
      {isWarmingUp && warmupStatus && (
        <div className="mb-3 p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--cyan)/0.3)]">
          <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--cyan))] mb-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{warmupStatus.message}</span>
            <span className="text-[hsl(var(--text-muted))]">({warmupStatus.progress}%)</span>
          </div>
          <div className="h-1 bg-[hsl(var(--bg-elevated))] rounded-full overflow-hidden">
            <div
              className="h-full bg-[hsl(var(--cyan))] transition-all duration-300"
              style={{ width: `${warmupStatus.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Warmup Logs */}
      {isWarmingUp && (
        <div className="mb-3">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))] mb-1"
          >
            {showLogs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Terminal className="h-3 w-3" />
            Boot Logs
          </button>
          {showLogs && (
            <pre
              ref={logContainerRef}
              className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2 text-[9px] font-mono text-[hsl(var(--text-secondary))] max-h-48 overflow-auto whitespace-pre-wrap"
            >
              {logsData?.logs || 'Waiting for boot output...'}
            </pre>
          )}
        </div>
      )}

      {/* Error */}
      {hasError && warmupStatus?.error && (
        <div className="mb-3 p-2 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-[10px] text-[hsl(var(--red))]">
          <div className="flex items-start justify-between gap-2">
            <span>{warmupStatus.error}</span>
            <button
              onClick={handleDismissError}
              className="shrink-0 p-0.5 hover:bg-[hsl(var(--red)/0.2)] rounded"
              title="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Features */}
      <div className="flex gap-3 mb-3 text-[10px]">
        <span className={image.hasKernel ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--text-muted))]'}>
          {image.hasKernel ? <Check className="h-3 w-3 inline mr-0.5" /> : '○ '}
          Kernel
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-[hsl(var(--border))]">
        {!image.hasWarmupSnapshot && !isWarmingUp && (
          <button
            onClick={onWarmup}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <RefreshCw className="h-3 w-3" />
            Create Fast Boot Cache
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onDelete}
          disabled={isDeleting || isWarmingUp}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
        >
          {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

function CreateBaseImageModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { data: vms } = useVms();
  const [method, setMethod] = useState<CreateMethod | null>(null);

  const runningVms = vms?.filter(vm => vm.status === 'running') || [];

  if (!method) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div
          className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-md p-6"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))]">Add Base Image</h2>
            <button onClick={onClose} className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => setMethod('import')}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] transition-colors"
            >
              <Upload className="h-5 w-5 text-[hsl(var(--cyan))]" />
              <div>
                <div className="text-sm font-medium text-[hsl(var(--text-primary))]">Import QCOW2</div>
                <div className="text-xs text-[hsl(var(--text-muted))]">From local file path on server</div>
              </div>
            </button>

            <button
              onClick={() => setMethod('download')}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] transition-colors"
            >
              <Download className="h-5 w-5 text-[hsl(var(--purple))]" />
              <div>
                <div className="text-sm font-medium text-[hsl(var(--text-primary))]">Download from URL</div>
                <div className="text-xs text-[hsl(var(--text-muted))]">Ubuntu, Debian cloud images</div>
              </div>
            </button>

            <button
              onClick={() => setMethod('snapshot')}
              disabled={runningVms.length === 0}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Camera className="h-5 w-5 text-[hsl(var(--green))]" />
              <div>
                <div className="text-sm font-medium text-[hsl(var(--text-primary))]">Snapshot Running VM</div>
                <div className="text-xs text-[hsl(var(--text-muted))]">
                  {runningVms.length > 0
                    ? `${runningVms.length} running VM${runningVms.length !== 1 ? 's' : ''} available`
                    : 'No running VMs'}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render specific form based on method
  const FormComponent = {
    import: ImportQcow2Form,
    download: DownloadImageForm,
    snapshot: SnapshotVmForm,
  }[method];

  return <FormComponent onClose={onClose} onBack={() => setMethod(null)} vms={vms || []} />;
}

interface FormProps {
  onClose: () => void;
  onBack: () => void;
  vms: Array<{ id: string; name: string; status: string }>;
}

function ImportQcow2Form({ onClose, onBack }: FormProps) {
  const [name, setName] = useState('');
  const [qcow2Path, setQcow2Path] = useState('');
  const [kernelPath, setKernelPath] = useState('');
  const [initrdPath, setInitrdPath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      // TODO: Implement API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import image');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <button onClick={onBack} className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))]">Import QCOW2 Image</h2>
        </div>

        {error && (
          <div className="mb-4 p-2 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-xs text-[hsl(var(--red))]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Image Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="my-custom-image"
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">QCOW2 Path *</label>
            <input
              type="text"
              value={qcow2Path}
              onChange={e => setQcow2Path(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="/path/to/image.qcow2"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Kernel Path (optional)</label>
            <input
              type="text"
              value={kernelPath}
              onChange={e => setKernelPath(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="/path/to/vmlinuz"
            />
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">InitRD Path (optional)</label>
            <input
              type="text"
              value={initrdPath}
              onChange={e => setInitrdPath(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="/path/to/initrd.img"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name || !qcow2Path}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)] hover:bg-[hsl(var(--cyan)/0.1)] disabled:opacity-50"
            >
              {isSubmitting ? 'Importing...' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DownloadImageForm({ onClose, onBack }: FormProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kernelUrl, setKernelUrl] = useState('');
  const [initrdUrl, setInitrdUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ phase: string; percent: number } | null>(null);

  const presets = [
    {
      name: 'Ubuntu 24.04 (Noble)',
      imageName: 'ubuntu-24.04',
      url: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    },
    {
      name: 'Ubuntu 22.04 (Jammy)',
      imageName: 'ubuntu-22.04',
      url: 'https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img',
    },
    {
      name: 'Debian 12 (Bookworm)',
      imageName: 'debian-12',
      url: 'https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2',
    },
  ];

  const applyPreset = (preset: (typeof presets)[0]) => {
    setName(preset.imageName);
    setUrl(preset.url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setProgress({ phase: 'Starting download...', percent: 0 });

    try {
      // TODO: Implement API call with SSE progress
      await new Promise(resolve => setTimeout(resolve, 2000));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download image');
    } finally {
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-lg p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <button onClick={onBack} className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))]">Download Cloud Image</h2>
        </div>

        {/* Presets */}
        <div className="mb-4">
          <label className="block text-xs text-[hsl(var(--text-muted))] mb-2">Quick Select</label>
          <div className="flex flex-wrap gap-2">
            {presets.map(preset => (
              <button
                key={preset.imageName}
                type="button"
                onClick={() => applyPreset(preset)}
                className="px-2 py-1 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--border))] transition-colors"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-xs text-[hsl(var(--red))]">
            {error}
          </div>
        )}

        {progress && (
          <div className="mb-4 p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
            <div className="flex items-center justify-between text-xs text-[hsl(var(--text-secondary))] mb-2">
              <span>{progress.phase}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-1.5 bg-[hsl(var(--bg-elevated))] rounded-full overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--cyan))] transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Image Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="my-custom-image"
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
              required
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Image URL *</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="https://cloud-images.ubuntu.com/..."
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Kernel URL (optional)</label>
              <input
                type="url"
                value={kernelUrl}
                onChange={e => setKernelUrl(e.target.value)}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                placeholder="https://..."
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">InitRD URL (optional)</label>
              <input
                type="url"
                value={initrdUrl}
                onChange={e => setInitrdUrl(e.target.value)}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                placeholder="https://..."
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name || !url}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)] hover:bg-[hsl(var(--cyan)/0.1)] disabled:opacity-50"
            >
              {isSubmitting ? 'Downloading...' : 'Download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SnapshotVmForm({ onClose, onBack, vms }: FormProps) {
  const [name, setName] = useState('');
  const [selectedVmId, setSelectedVmId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ phase: string; percent: number } | null>(null);

  const runningVms = vms.filter(vm => vm.status === 'running');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setProgress({ phase: 'Pausing VM...', percent: 10 });

    try {
      // TODO: Implement API call with SSE progress
      await new Promise(resolve => setTimeout(resolve, 2000));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create snapshot');
    } finally {
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <button onClick={onBack} className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))]">Snapshot Running VM</h2>
        </div>

        {error && (
          <div className="mb-4 p-2 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-xs text-[hsl(var(--red))]">
            {error}
          </div>
        )}

        {progress && (
          <div className="mb-4 p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
            <div className="flex items-center justify-between text-xs text-[hsl(var(--text-secondary))] mb-2">
              <span>{progress.phase}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-1.5 bg-[hsl(var(--bg-elevated))] rounded-full overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--cyan))] transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Select VM *</label>
            <select
              value={selectedVmId}
              onChange={e => setSelectedVmId(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              required
              disabled={isSubmitting}
            >
              <option value="">Choose a running VM...</option>
              {runningVms.map(vm => (
                <option key={vm.id} value={vm.id}>
                  {vm.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-[hsl(var(--text-muted))]">
              The VM will be briefly paused during snapshot creation
            </p>
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">New Image Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="my-vm-snapshot"
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name || !selectedVmId}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)] hover:bg-[hsl(var(--cyan)/0.1)] disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Snapshot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function VMBaseImages() {
  const { data: baseImages, isLoading, error } = useVmBaseImages();
  const deleteImage = useDeleteVmBaseImage();
  const triggerWarmup = useTriggerVmWarmup();
  const confirm = useConfirm();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleDelete = async (name: string) => {
    const confirmed = await confirm({
      title: 'Delete Base Image',
      message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      deleteImage.mutate(name);
    }
  };

  const handleWarmup = (name: string) => {
    // Just trigger the warmup - progress is shown via polling
    triggerWarmup.mutate(name);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--text-muted))]">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading base images...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--red))]">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Failed to load base images: {String(error)}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-[hsl(var(--text-muted))]">
          {baseImages?.length || 0} base image{(baseImages?.length || 0) !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Base Image
        </button>
      </div>

      {/* Base Images Grid */}
      {baseImages && baseImages.length > 0 ? (
        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
          {baseImages.map(image => (
            <BaseImageCard
              key={image.name}
              image={image}
              onDelete={() => handleDelete(image.name)}
              onWarmup={() => handleWarmup(image.name)}
              isDeleting={deleteImage.isPending && deleteImage.variables === image.name}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-[hsl(var(--text-muted))]">
          <HardDrive className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm mb-1">No base images</p>
          <p className="text-xs mb-4">Add a base image to create VMs from</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Base Image
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && <CreateBaseImageModal onClose={() => setShowCreateModal(false)} />}
    </div>
  );
}
