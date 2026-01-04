import { useState } from 'react';
import { Camera, Trash2, Loader2, AlertTriangle, Server } from 'lucide-react';
import { useAllVmSnapshots, useDeleteVmSnapshot } from '../hooks/useContainers';
import { VmSnapshotWithVmInfo } from '../api/client';
import { useConfirm } from './ConfirmModal';

function formatSize(bytes?: number): string {
  if (!bytes) return 'Unknown';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function SnapshotCard({ snapshot }: { snapshot: VmSnapshotWithVmInfo }) {
  const deleteSnapshot = useDeleteVmSnapshot();
  const confirm = useConfirm();

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Snapshot',
      message: `Are you sure you want to delete "${snapshot.name || snapshot.id}"?`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      deleteSnapshot.mutate({ vmId: snapshot.vmId, snapshotId: snapshot.id });
    }
  };

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-4 hover:border-[hsl(var(--cyan)/0.3)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-[hsl(var(--purple))]" />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">
            {snapshot.name || snapshot.id}
          </h3>
        </div>
      </div>

      {/* VM Info */}
      <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))] mb-2">
        <Server className="h-3 w-3" />
        <span className="text-[hsl(var(--cyan))]">{snapshot.vmName}</span>
      </div>

      {/* Details */}
      <div className="text-[10px] text-[hsl(var(--text-muted))] space-y-1 mb-3">
        <div>Created: {formatDate(snapshot.createdAt)}</div>
        <div>Size: {formatSize(snapshot.sizeBytes)}</div>
        <div className="truncate" title={snapshot.baseImage}>
          Base: {snapshot.baseImage}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-[hsl(var(--border))]">
        <div className="flex-1" />
        <button
          onClick={handleDelete}
          disabled={deleteSnapshot.isPending}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
          title="Delete snapshot"
        >
          {deleteSnapshot.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          Delete
        </button>
      </div>
    </div>
  );
}

export function VMSnapshots() {
  const { data: snapshots, isLoading, error } = useAllVmSnapshots();
  const [filterVm, setFilterVm] = useState<string>('all');

  // Get unique VM names for filter
  const vmNames = [...new Set(snapshots?.map(s => s.vmName) || [])];

  // Filter snapshots
  const filteredSnapshots = filterVm === 'all'
    ? snapshots
    : snapshots?.filter(s => s.vmName === filterVm);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--text-muted))]">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading snapshots...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--red))]">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Failed to load snapshots: {String(error)}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[hsl(var(--text-muted))]">
            {filteredSnapshots?.length || 0} snapshot{(filteredSnapshots?.length || 0) !== 1 ? 's' : ''}
          </span>
          {vmNames.length > 1 && (
            <select
              value={filterVm}
              onChange={e => setFilterVm(e.target.value)}
              className="px-2 py-1 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
            >
              <option value="all">All VMs</option>
              {vmNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Snapshots Grid */}
      {filteredSnapshots && filteredSnapshots.length > 0 ? (
        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
          {filteredSnapshots.map(snapshot => (
            <SnapshotCard key={`${snapshot.vmId}-${snapshot.id}`} snapshot={snapshot} />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-[hsl(var(--text-muted))]">
          <Camera className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm mb-1">No snapshots</p>
          <p className="text-xs">Take a snapshot from a running VM to save its state</p>
        </div>
      )}
    </div>
  );
}
