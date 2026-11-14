import { z } from 'zod';

export const WorkerJobRequestSchema = z.object({
  jobId: z.number().int().nonnegative(),
  jobVersion: z.number().int().nonnegative(),
  type: z.enum(['init_grid', 'compute_paths', 'evaluate_cover', 'cancel_before']),
  gridWidth: z.number().int().positive().optional(),
  gridHeight: z.number().int().positive().optional(),
  cellSize: z.number().positive().optional(),
  originX: z.number().optional(),
  originZ: z.number().optional(),
});
export type WorkerJobRequest = z.infer<typeof WorkerJobRequestSchema>;

export const WorkerJobResponseSchema = z.object({
  jobId: z.number().int().nonnegative(),
  jobVersion: z.number().int().nonnegative(),
  type: z.enum(['grid_ready', 'paths_result', 'cover_result', 'worker_error']),
  computeMs: z.number().nonnegative().default(0),
  errorMessage: z.string().optional(),
});
export type WorkerJobResponse = z.infer<typeof WorkerJobResponseSchema>;
