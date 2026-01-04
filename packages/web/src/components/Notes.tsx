import { Copy, Check, Terminal, Plus, X, Loader2, Trash2, Edit3 } from 'lucide-react';
import { useState, useEffect } from 'react';
import * as api from '../api/client';
import type { Note } from '../api/client';

interface CommandItem {
  id?: string;
  label: string;
  command: string;
  description?: string;
  isDefault?: boolean;
}

const defaultCommands: CommandItem[] = [
  {
    label: 'Install Claude Code',
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    description: 'Official CLI for Claude by Anthropic',
    isDefault: true,
  },
  {
    label: 'Install Open Code',
    command: 'curl -fsSL https://opencode.ai/install | bash',
    description: 'Open source AI coding assistant',
    isDefault: true,
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[hsl(var(--green))]" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

interface NoteModalProps {
  note?: Note | null;
  onClose: () => void;
  onSave: (data: { title: string; description?: string; body: string }) => Promise<void>;
}

function NoteModal({ note, onClose, onSave }: NoteModalProps) {
  const [title, setTitle] = useState(note?.title || '');
  const [description, setDescription] = useState(note?.description || '');
  const [body, setBody] = useState(note?.body || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!note;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        body: body.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
    }
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-[500px] max-w-[90vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
            {isEditing ? 'Edit Note' : 'New Note'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., MCP Server Install"
                autoFocus
                className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description (optional)"
                className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                Body / Command *
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Command or text to copy..."
                rows={4}
                className="w-full px-3 py-2 text-xs font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan))] focus:outline-none resize-none"
              />
              <p className="text-[10px] text-[hsl(var(--text-muted))]">
                This will be copied to clipboard when clicked
              </p>
            </div>

            {error && (
              <div className="px-3 py-2 text-xs bg-[hsl(var(--red)/0.1)] text-[hsl(var(--red))] border border-[hsl(var(--red)/0.3)]">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !body.trim() || isSaving}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving...
                </>
              ) : (
                isEditing ? 'Save Changes' : 'Add Note'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Notes() {
  const [userNotes, setUserNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    try {
      const { notes } = await api.getNotes();
      setUserNotes(notes);
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
    setIsLoading(false);
  };

  const handleCreateNote = async (data: { title: string; description?: string; body: string }) => {
    await api.createNote(data);
    await loadNotes();
  };

  const handleUpdateNote = async (data: { title: string; description?: string; body: string }) => {
    if (!editingNote) return;
    await api.updateNote(editingNote.id, data);
    await loadNotes();
  };

  const handleDeleteNote = async (id: string) => {
    await api.deleteNote(id);
    await loadNotes();
  };

  const openCreateModal = () => {
    setEditingNote(null);
    setShowModal(true);
  };

  const openEditModal = (note: Note) => {
    setEditingNote(note);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingNote(null);
  };

  // Combine default commands and user notes
  const allItems: CommandItem[] = [
    ...defaultCommands,
    ...userNotes.map(note => ({
      id: note.id,
      label: note.title,
      command: note.body,
      description: note.description,
      isDefault: false,
    })),
  ];

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Quick Reference
            </h2>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
              Useful commands and installation scripts
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        {/* Commands Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
            <Terminal className="h-3 w-3" />
            <span>Commands & Notes</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
            </div>
          ) : (
            <div className="space-y-3">
              {allItems.map((item, index) => (
                <div
                  key={item.id || `default-${index}`}
                  className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] overflow-hidden group"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[hsl(var(--text-primary))]">
                        {item.label}
                      </span>
                      <span className={`px-1.5 py-0.5 text-[8px] uppercase tracking-wider ${
                        item.isDefault
                          ? 'bg-[hsl(var(--text-muted)/0.2)] text-[hsl(var(--text-muted))]'
                          : 'bg-[hsl(var(--cyan)/0.2)] text-[hsl(var(--cyan))]'
                      }`}>
                        {item.isDefault ? 'Default' : 'Custom'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {!item.isDefault && item.id && (
                        <>
                          <button
                            onClick={() => {
                              const note = userNotes.find(n => n.id === item.id);
                              if (note) openEditModal(note);
                            }}
                            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-base))] transition-colors opacity-0 group-hover:opacity-100"
                            title="Edit"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteNote(item.id!)}
                            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-base))] transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      <CopyButton text={item.command} />
                    </div>
                  </div>
                  <div className="p-3">
                    <code className="block text-[11px] font-mono text-[hsl(var(--cyan))] break-all whitespace-pre-wrap">
                      {item.command}
                    </code>
                    {item.description && (
                      <p className="text-[10px] text-[hsl(var(--text-muted))] mt-2">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Note Modal */}
      {showModal && (
        <NoteModal
          note={editingNote}
          onClose={closeModal}
          onSave={editingNote ? handleUpdateNote : handleCreateNote}
        />
      )}
    </div>
  );
}
