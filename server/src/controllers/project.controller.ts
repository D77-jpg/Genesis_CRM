import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { createProject, listProjects, updateProject } from '../services/project.service';
import type { CreateProjectInput, UpdateProjectInput } from '../validators/project.validator';

export const listProjectsHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await listProjects(req.user!));
});

export const createProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await createProject(req.body as CreateProjectInput, req.user!), 201);
});

export const updateProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await updateProject(req.params.id, req.body as UpdateProjectInput));
});
