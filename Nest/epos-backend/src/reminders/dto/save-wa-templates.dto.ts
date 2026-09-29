import { IsObject } from 'class-validator';

/** `templates` kuncinya opsional (selesai_servis/reminder_h3/reminder_h7) —
 * yang dikirim di-upsert, yang gak dikirim gak disentuh. Validasi isi
 * per-kind (kind dikenal, panjang, placeholder valid) dilakukan manual di
 * RemindersService.saveTemplates, bukan di DTO — pesannya butuh nyebut kind
 * mana yang salah, class-validator gak cocok buat itu di sini. */
export class SaveWaTemplatesDto {
  @IsObject()
  templates!: Record<string, string>;
}
