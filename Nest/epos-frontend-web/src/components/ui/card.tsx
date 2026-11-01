import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * `panel`: section dengan pita judul abu-abu muda (CardHeader) dan isi berpadding sendiri, supaya
 * terpisah jelas dari latar halaman. Jangan dipakai bila CardContent sengaja `p-0` (tabel penuh).
 */
function Card({ className, panel, ...props }: React.ComponentProps<'div'> & { panel?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-card text-card-foreground flex flex-col gap-4 rounded-xl border py-5 shadow-sm',
        panel &&
          'gap-0 overflow-hidden py-0 [&>[data-slot=card-header]]:border-b [&>[data-slot=card-header]]:bg-muted/60 [&>[data-slot=card-header]]:py-4 [&>[data-slot=card-content]]:py-5',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-5 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-5',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      // font-display = Plus Jakarta Sans, padanan titleTextStyle/titleLarge
      // Flutter — heading di style guide selalu display face, bukan body.
      className={cn('leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-5', className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-5 [.border-t]:pt-5', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
