import { IsObject } from 'class-validator';

/** Payload RPC `save_wa_reminder_templates`: { templates: { <kind>: teks } }.
 * Kind, panjang, dan placeholder divalidasi RPC. */
export class SaveWaTemplatesDto {
  @IsObject()
  templates: Record<string, string>;
}
