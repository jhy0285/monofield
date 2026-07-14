const express = require('express');
const { celebrate, Joi, Segments } = require('celebrate');

const router = express.Router();

// GET /api/users — list, query params described by a celebrate/Joi schema
router.get(
  '/',
  celebrate({
    [Segments.QUERY]: Joi.object({
      page: Joi.number().integer().min(1).optional(),
      size: Joi.number().integer().max(100).optional(),
      keyword: Joi.string().optional(),
    }),
  }),
  (req, res) => {
    res.json({ total: 0, page: 1, items: [] });
  }
);

// GET /api/users/:id — no schema, handler reads req.* directly
router.get('/:id', (req, res) => {
  const userId = req.params.id;
  const expand = req.query.expand;
  res.json({ userId, email: 'user@example.com', name: 'name', expand });
});

// POST /api/users — body described by a celebrate/Joi schema (nested object)
router.post(
  '/',
  celebrate({
    [Segments.BODY]: Joi.object({
      email: Joi.string().email().required(),
      name: Joi.string().required(),
      age: Joi.number().integer().min(0).optional(),
      address: Joi.object({
        city: Joi.string().required(),
        street: Joi.string().required(),
        zipCode: Joi.string().optional(),
      }).required(),
    }),
  }),
  (req, res) => {
    res.status(201).json({ userId: 'u-1', email: req.body.email, name: req.body.name });
  }
);

module.exports = router;
