import { z } from 'zod';

/**
 * Every write schema lives here and is imported by both the API and the frontend
 * forms, so client and server validation cannot disagree — the rules are written
 * once and run twice.
 */
export const uuid = z.string().uuid('Must be a valid id');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(v => !Number.isNaN(Date.parse(v)), 'Not a real date');
export const pagination = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters').max(128)
    .refine(v => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Include at least one letter and one number'),
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(10).optional() });
export const roleSchema = z.object({ role: z.enum(['patient', 'clinician', 'admin']) });
export const staffUserSchema = signupSchema.extend({ role: z.enum(['patient', 'clinician', 'admin']).default('clinician') });

export const hospitalQuerySchema = z.object({
  ...pagination,
  q: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  minBeds: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['name', 'beds', 'created_at']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export const hospitalUpdateSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  beds: z.coerce.number().int().min(0).max(10000).optional(),
  isActive: z.coerce.boolean().optional(),
}).refine(v => Object.keys(v).length > 0, 'Nothing to update');

export const patientCreateSchema = z.object({
  mrn: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only'),
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: isoDate.optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  phone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(80).optional(),
});
export const patientUpdateSchema = patientCreateSchema.partial().omit({ mrn: true });
export const patientQuerySchema = z.object({
  ...pagination,
  q: z.string().trim().max(120).optional(),
  mrn: z.string().trim().max(30).optional(),
  sort: z.enum(['full_name', 'created_at', 'date_of_birth']).default('full_name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const appointmentCreateSchema = z.object({
  hospitalId: uuid,
  departmentId: uuid.optional(),
  doctorId: uuid.optional(),
  patientId: uuid,
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use an ISO timestamp')),
  durationMin: z.coerce.number().int().min(5).max(240).default(15),
  status: z.enum(['scheduled', 'completed', 'no_show', 'cancelled']).default('scheduled'),
  diagnosisText: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export const appointmentUpdateSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'no_show', 'cancelled']).optional(),
  diagnosisText: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  scheduledAt: z.string().optional(),
  durationMin: z.coerce.number().int().min(5).max(240).optional(),
}).refine(v => Object.keys(v).length > 0, 'Nothing to update');
export const appointmentQuerySchema = z.object({
  ...pagination,
  hospitalId: uuid.optional(),
  patientId: uuid.optional(),
  doctorId: uuid.optional(),
  status: z.enum(['scheduled', 'completed', 'no_show', 'cancelled']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(120).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const admissionCreateSchema = z.object({
  hospitalId: uuid,
  departmentId: uuid.optional(),
  patientId: uuid,
  bedId: uuid.optional(),
  admittedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD'),
  dischargeDate: isoDate.optional(),
  dischargeDisposition: z.enum(['home', 'transfer', 'deceased', 'ama']).optional(),
  diagnosisText: z.string().trim().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.dischargeDate && Date.parse(v.dischargeDate) < Date.parse(v.admittedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dischargeDate'], message: 'Discharge cannot be before admission' });
  }
});
export const admissionUpdateSchema = z.object({
  dischargeDate: isoDate.nullable().optional(),
  dischargeDisposition: z.enum(['home', 'transfer', 'deceased', 'ama']).nullable().optional(),
  diagnosisText: z.string().trim().max(500).optional(),
}).refine(v => Object.keys(v).length > 0, 'Nothing to update');
export const admissionQuerySchema = z.object({
  ...pagination,
  hospitalId: uuid.optional(),
  patientId: uuid.optional(),
  open: z.enum(['true', 'false']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const prescriptionCreateSchema = z.object({
  patientId: uuid,
  appointmentId: uuid.optional(),
  admissionId: uuid.optional(),
  doctorId: uuid.optional(),
  instructions: z.string().trim().max(1000).optional(),
  items: z.array(z.object({
    drug: z.string().trim().min(1).max(120),
    dose: z.string().trim().max(60).optional(),
    frequency: z.string().trim().max(60).optional(),
    durationDays: z.coerce.number().int().min(1).max(365).optional(),
  })).min(1, 'A prescription needs at least one drug').max(30),
});
export const prescriptionQuerySchema = z.object({
  ...pagination, patientId: uuid.optional(),
});

export const labTestQuerySchema = z.object({
  ...pagination, patientId: uuid.optional(), hospitalId: uuid.optional(),
  status: z.enum(['ordered', 'collected', 'resulted', 'cancelled']).optional(),
});

export const invoiceQuerySchema = z.object({
  ...pagination, hospitalId: uuid.optional(), patientId: uuid.optional(),
  status: z.enum(['issued', 'paid', 'claimed', 'rejected']).optional(),
});

export const metricsQuerySchema = z.object({
  hospitalId: uuid.optional(),
  from: isoDate,
  to: isoDate,
}).refine(v => Date.parse(v.to) > Date.parse(v.from), { message: 'The window must end after it starts', path: ['to'] });

export const mediaQuerySchema = z.object({
  entityType: z.enum(['patient', 'hospital', 'prescription']),
  entityId: uuid,
});
