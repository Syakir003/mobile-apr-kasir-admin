import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Tombol halaman sebelumnya / berikutnya dengan nama aksesibel (tombol ikon tanpa nama tidak terbaca pembaca layar). */
export function PaginationButtons({
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="icon" aria-label="Halaman sebelumnya" disabled={!canPrev} onClick={onPrev}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <Button variant="outline" size="icon" aria-label="Halaman berikutnya" disabled={!canNext} onClick={onNext}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
