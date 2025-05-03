const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/todo-app';

// Import routes
const todoRoutes = require('./routes/todoRoutes');
const authRoutes = require('./routes/auth');

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/todos', todoRoutes);
app.use('/api', authRoutes);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB:', err));

// Setup daily task analysis cron job (runs at midnight)
cron.schedule('0 0 * * *', async () => {
  console.log('Running automated task analysis and planning for tomorrow');
  try {
    const response = await fetch(`http://localhost:${PORT}/api/todos/plan-tomorrow`, {
      method: 'POST'
    });
    const result = await response.json();
    console.log('Auto-planning result:', result);
  } catch (error) {
    console.error('Error in auto-planning cron job:', error);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});