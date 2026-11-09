import { BadRequestException } from '@nestjs/common';
import {
  assertValidTechnicians,
  assignedTo,
  isJobAssignee,
  normalizeTechnicianIds,
  setJobAssignees,
} from './job-assignees';

// Penugasan beberapa teknisi per job: helper tunggal untuk normalisasi id, validasi, penulisan assignees,
// dan pengecekan keanggotaan (dipakai semua guard akses job).

describe('normalizeTechnicianIds', () => {
  it('technicianId lama dianggap daftar berisi satu', () => {
    expect(normalizeTechnicianIds({ technicianId: 'a' })).toEqual(['a']);
  });

  it('technicianIds menang atas technicianId, duplikat dibuang, urutan dipertahankan', () => {
    expect(normalizeTechnicianIds({ technicianIds: ['a', 'b', 'a'], technicianId: 'z' })).toEqual(['a', 'b']);
  });

  it('tanpa apa pun, null, atau string kosong -> daftar kosong', () => {
    expect(normalizeTechnicianIds({})).toEqual([]);
    expect(normalizeTechnicianIds({ technicianId: null })).toEqual([]);
    expect(normalizeTechnicianIds({ technicianIds: ['', '  '] })).toEqual([]);
  });
});

describe('assertValidTechnicians', () => {
  const db = (users: { id: string; role: string; active: boolean }[]) => ({
    user: { findMany: jest.fn(async ({ where }: any) => users.filter((u) => where.id.in.includes(u.id))) },
  });
  const ok = (id: string) => ({ id, role: 'teknisi', active: true });

  it('daftar kosong lolos tanpa query', async () => {
    const d = db([]);
    await expect(assertValidTechnicians(d as any, [])).resolves.toBeUndefined();
    expect(d.user.findMany).not.toHaveBeenCalled();
  });

  it('semua teknisi aktif lolos', async () => {
    await expect(assertValidTechnicians(db([ok('a'), ok('b')]) as any, ['a', 'b'])).resolves.toBeUndefined();
  });

  it('lebih dari 5 teknisi ditolak', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    await expect(assertValidTechnicians(db(ids.map(ok)) as any, ids)).rejects.toThrow(
      new BadRequestException('Maksimal 5 teknisi per job'),
    );
  });

  it('id yang tidak ditemukan, user nonaktif, atau bukan teknisi ditolak', async () => {
    const msg = new BadRequestException('Teknisi tidak valid atau tidak aktif');
    await expect(assertValidTechnicians(db([ok('a')]) as any, ['a', 'x'])).rejects.toThrow(msg);
    await expect(
      assertValidTechnicians(db([ok('a'), { id: 'b', role: 'teknisi', active: false }]) as any, ['a', 'b']),
    ).rejects.toThrow(msg);
    await expect(
      assertValidTechnicians(db([ok('a'), { id: 'k', role: 'kasir', active: true }]) as any, ['a', 'k']),
    ).rejects.toThrow(msg);
  });
});

describe('setJobAssignees', () => {
  const tx = () => ({
    technicianJobAssignee: { deleteMany: jest.fn(async () => ({})), createMany: jest.fn(async () => ({})) },
    technicianJob: { update: jest.fn(async () => ({})) },
  });

  it('mengganti seluruh baris assignees dan menjadikan teknisi pertama sebagai technicianId', async () => {
    const t = tx();
    await setJobAssignees(t as any, 'j1', ['b', 'a']);
    expect(t.technicianJobAssignee.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'j1' } });
    expect(t.technicianJobAssignee.createMany).toHaveBeenCalledWith({
      data: [
        { jobId: 'j1', technicianId: 'b' },
        { jobId: 'j1', technicianId: 'a' },
      ],
    });
    expect(t.technicianJob.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { technicianId: 'b' } });
  });

  it('daftar kosong menghapus semua assignees dan mengosongkan technicianId', async () => {
    const t = tx();
    await setJobAssignees(t as any, 'j1', []);
    expect(t.technicianJobAssignee.createMany).not.toHaveBeenCalled();
    expect(t.technicianJob.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { technicianId: null } });
  });
});

describe('isJobAssignee / assignedTo', () => {
  it('true bila ada baris assignees untuk pasangan job-user itu', async () => {
    const db = { technicianJobAssignee: { count: jest.fn(async () => 1) } };
    await expect(isJobAssignee(db as any, 'j1', 't2')).resolves.toBe(true);
    expect(db.technicianJobAssignee.count).toHaveBeenCalledWith({ where: { jobId: 'j1', technicianId: 't2' } });
  });

  it('false bila tidak ada barisnya', async () => {
    const db = { technicianJobAssignee: { count: jest.fn(async () => 0) } };
    await expect(isJobAssignee(db as any, 'j1', 't9')).resolves.toBe(false);
  });

  it('assignedTo membangun filter keanggotaan', () => {
    expect(assignedTo('t2')).toEqual({ assignees: { some: { technicianId: 't2' } } });
  });
});
