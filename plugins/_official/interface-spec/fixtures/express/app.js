const express = require('express');
const usersRouter = require('./routes/users');
const ordersRouter = require('./routes/orders');

const app = express();

app.use(express.json());

// direct app-level route, no router mount
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/users', usersRouter);
app.use('/api/orders', ordersRouter);

app.listen(3000, () => {
  console.log('fixture app listening on 3000');
});

module.exports = app;
