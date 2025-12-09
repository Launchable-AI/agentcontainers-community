import { Copy, Check, Terminal } from 'lucide-react';
import { useState } from 'react';

interface CommandItem {
  label: string;
  command: string;
  description?: string;
}

const commands: CommandItem[] = [
  {
    label: 'Install Claude Code',
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    description: 'Official CLI for Claude by Anthropic',
  },
  {
    label: 'Install Open Code',
    command: 'curl -fsSL https://opencode.ai/install | bash',
    description: 'Open source AI coding assistant',
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

export function Notes() {
  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="pb-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
            Quick Reference
          </h2>
          <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
            Useful commands and installation scripts
          </p>
        </div>

        {/* Commands Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
            <Terminal className="h-3 w-3" />
            <span>Installation Commands</span>
          </div>

          <div className="space-y-3">
            {commands.map((item, index) => (
              <div
                key={index}
                className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
                  <span className="text-xs font-medium text-[hsl(var(--text-primary))]">
                    {item.label}
                  </span>
                  <CopyButton text={item.command} />
                </div>
                <div className="p-3">
                  <code className="block text-[11px] font-mono text-[hsl(var(--cyan))] break-all">
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
        </div>
      </div>
    </div>
  );
}
