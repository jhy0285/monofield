const express = require('express');

const router = express.Router();

// POST /api/orders — no schema: request shape only visible via req.body usage
router.post('/', async (req, res) => {
  const customerId = req.body.customerId;
  const { items, memo } = req.body;
  if (!customerId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  res.status(201).json({ orderId: 'o-1', status: 'CREATED', totalAmount: 0 });
});

// GET /api/orders/:orderId — literal response object
router.get('/:orderId', (req, res) => {
  res.json({ orderId: req.params.orderId, status: 'CREATED', items: [] });
});

module.exports = router;
