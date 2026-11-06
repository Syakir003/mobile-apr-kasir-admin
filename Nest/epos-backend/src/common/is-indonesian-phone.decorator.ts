import { registerDecorator, type ValidationOptions } from 'class-validator';

import { isValidIndonesianPhone, PHONE_ERROR_MESSAGE } from './phone.util';

/** Validator DTO: nomor HP harus memenuhi batas nomor standar Indonesia (lihat isValidIndonesianPhone). */
export function IsIndonesianPhone(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIndonesianPhone',
      target: object.constructor,
      propertyName,
      options: { message: PHONE_ERROR_MESSAGE, ...options },
      validator: {
        validate: (value: unknown) => isValidIndonesianPhone(value),
      },
    });
  };
}
