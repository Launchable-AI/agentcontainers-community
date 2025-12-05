import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context.confirm;
}

interface ConfirmProviderProps {
  children: ReactNode;
}

export function ConfirmProvider({ children }: ConfirmProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolveRef, setResolveRef] = useState<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setOptions(opts);
      setResolveRef(() => resolve);
      setIsOpen(true);
    });
  }, []);

  const handleConfirm = () => {
    setIsOpen(false);
    resolveRef?.(true);
  };

  const handleCancel = () => {
    setIsOpen(false);
    resolveRef?.(false);
  };

  const variantConfig = {
    danger: {
      icon: Trash2,
      iconBg: 'bg-[hsl(var(--red)/0.1)]',
      iconColor: 'text-[hsl(var(--red))]',
      buttonBg: 'bg-[hsl(var(--red))]',
      buttonHover: 'hover:bg-[hsl(var(--red)/0.9)]',
      borderColor: 'border-[hsl(var(--red)/0.3)]',
    },
    warning: {
      icon: AlertTriangle,
      iconBg: 'bg-[hsl(var(--amber)/0.1)]',
      iconColor: 'text-[hsl(var(--amber))]',
      buttonBg: 'bg-[hsl(var(--amber))]',
      buttonHover: 'hover:bg-[hsl(var(--amber)/0.9)]',
      borderColor: 'border-[hsl(var(--amber)/0.3)]',
    },
    info: {
      icon: AlertTriangle,
      iconBg: 'bg-[hsl(var(--cyan)/0.1)]',
      iconColor: 'text-[hsl(var(--cyan))]',
      buttonBg: 'bg-[hsl(var(--cyan))]',
      buttonHover: 'hover:bg-[hsl(var(--cyan)/0.9)]',
      borderColor: 'border-[hsl(var(--cyan)/0.3)]',
    },
  };

  const variant = options?.variant || 'danger';
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {isOpen && options && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 animate-fade-in">
          <div
            className={`w-full max-w-md mx-4 bg-[hsl(var(--bg-surface))] border ${config.borderColor} shadow-2xl animate-scale-in`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-3">
                <div className={`p-2 ${config.iconBg}`}>
                  <Icon className={`h-4 w-4 ${config.iconColor}`} />
                </div>
                <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                  {options.title}
                </h3>
              </div>
              <button
                onClick={handleCancel}
                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-5">
              <p className="text-xs text-[hsl(var(--text-secondary))] leading-relaxed">
                {options.message}
              </p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] transition-colors"
              >
                {options.cancelText || 'Cancel'}
              </button>
              <button
                onClick={handleConfirm}
                className={`px-4 py-2 text-xs text-[hsl(var(--bg-base))] ${config.buttonBg} ${config.buttonHover} transition-colors`}
              >
                {options.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
