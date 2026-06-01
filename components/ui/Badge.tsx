import { cn } from '@/lib/utils'

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

type Props = {
  variant?: Variant
  children: React.ReactNode
  className?: string
}

const variantMap: Record<Variant, string> = {
  success: 'bg-green-100 text-green-800 border-green-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  error: 'bg-red-100 text-red-800 border-red-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
}

export const Badge = ({ variant = 'neutral', children, className }: Props) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
      variantMap[variant],
      className
    )}
  >
    {children}
  </span>
)
