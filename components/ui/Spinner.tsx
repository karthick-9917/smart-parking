import { cn } from '@/lib/utils'

type Props = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-4',
}

export const Spinner = ({ size = 'md', className }: Props) => (
  <div
    role="status"
    aria-label="Loading"
    className={cn(
      'animate-spin rounded-full border-blue-200 border-t-blue-600',
      sizeMap[size],
      className
    )}
  />
)
