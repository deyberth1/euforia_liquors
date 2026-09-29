import { cn } from '@/lib/cn';

const SRC = '/brand/logo.jpg';

/** Isotipo: el sello circular de la marca (imagen real). */
export function LogoMark({ className }: { className?: string }) {
  return <img src={SRC} alt="Euforia Liquors" draggable={false} className={cn('shrink-0 rounded-full object-cover select-none', className)} />;
}

/** Logotipo: sello + nombre. En tamaño grande el sello ya incluye el nombre, así que va solo. */
export function Logo({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  if (size === 'lg') {
    return (
      <div className={cn('flex flex-col items-center', className)}>
        <img src={SRC} alt="Euforia Liquors" draggable={false} className="h-44 w-44 rounded-full object-cover shadow-[0_0_60px_-10px_rgba(217,180,91,0.45)] select-none sm:h-52 sm:w-52" />
      </div>
    );
  }
  const mark = size === 'sm' ? 'h-10 w-10' : 'h-12 w-12';
  const name = size === 'sm' ? 'text-[15px]' : 'text-xl';
  const sub = size === 'sm' ? 'text-[9px]' : 'text-[11px]';
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark className={mark} />
      <div className="leading-none">
        <div className={cn('font-display font-black tracking-[0.06em] text-fg', name)}>EUFORIA</div>
        <div className={cn('mt-1 font-display font-semibold tracking-[0.34em] text-gold', sub)}>LIQUORS</div>
      </div>
    </div>
  );
}
