import { vi, test, expect, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import { asyncHandler } from '../rest/common/asyncHandler.js';
import { fromUvlValidator } from '../rest/validators/lineValidators.js';
import { onError } from '../rest/common/onError.js';

// the route as lineRouter mounts it: the validator, then a controller that asks the modular service to convert
const build = () => {
  const convert = vi.fn().mockResolvedValue({ text: 'featuremodel Root\nfeature Root\n' });
  const app = express();
  app.use(express.json());
  app.post('/api/lines/:id/model/from-uvl', (req, res, next) => { req.userId = 'user-1'; next(); }, fromUvlValidator, asyncHandler(async (req, res) => {
    res.status(200).send(await convert({ id: req.params.id, userId: req.userId, uvl: req.body.uvl }));
  }));
  app.use(onError);
  return { app, convert };
};

describe('POST /api/lines/:id/model/from-uvl', () => {
  test('gives the text the line keeps its feature model in', async () => {
    const { app, convert } = build();

    const res = await request(app).post('/api/lines/l1/model/from-uvl').send({ uvl: 'features\n    Root' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'featuremodel Root\nfeature Root\n' });
    expect(convert).toHaveBeenCalledWith({ id: 'l1', userId: 'user-1', uvl: 'features\n    Root' });
  });

  test('refuses a body with no UVL', async () => {
    const { app, convert } = build();

    const res = await request(app).post('/api/lines/l1/model/from-uvl').send({});

    expect(res.status).toBe(400);
    expect(convert).not.toHaveBeenCalled();
  });
});
