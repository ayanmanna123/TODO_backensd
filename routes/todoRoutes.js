const express = require('express');
const router = express.Router();
const Todo = require('../models/todoModel');
const auth = require('../middleware/auth'); // Use proper variable name

// Get all todos for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const todos = await Todo.find({ user: req.user.id });
    res.json(todos);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create a new todo
router.post('/', auth, async (req, res) => {
  const todo = new Todo({
    title: req.body.title,
    completed: req.body.completed || false,
    dueDate: req.body.dueDate,
    priority: req.body.priority || 'medium',
    tags: req.body.tags || [],
    category: req.body.category || 'general',
    notes: req.body.notes || '',
    user: req.user.id // Use user ID from token
  });

  try {
    const newTodo = await todo.save();
    res.status(201).json(newTodo);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update a todo
router.put('/:id', auth, async (req, res) => {
  try {
    const todo = await Todo.findOne({ 
      _id: req.params.id,
      user: req.user.id // Ensure the todo belongs to the user
    });
    
    if (!todo) {
      return res.status(404).json({ message: 'Todo not found' });
    }
    
    // Check if the todo is being marked as completed
    if (req.body.completed && !todo.completed) {
      req.body.completedAt = new Date();
    } else if (req.body.completed === false) {
      req.body.completedAt = null;
    }
    
    const updatedTodo = await Todo.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    
    res.json(updatedTodo);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete a todo
router.delete('/:id', auth, async (req, res) => {
  try {
    const todo = await Todo.findOne({
      _id: req.params.id,
      user: req.user.id // Ensure the todo belongs to the user
    });
     
    if (!todo) {
      return res.status(404).json({ message: 'Todo not found' });
    }
    
    await Todo.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Todo deleted' });
  } catch (error) {
    console.error('Error in delete route:', error);
    res.status(500).json({ message: error.message });
  }
});

// Analyze and plan tomorrow's tasks
router.post('/plan-tomorrow', auth, async (req, res) => {
  try {
    // Get completion statistics for the current user
    const completedTodos = await Todo.find({ 
      completed: true,
      user: req.user.id
    });
    
    const pendingTodos = await Todo.find({ 
      completed: false,
      user: req.user.id
    });
    
    // Rest of the planning code remains the same...
    // Analyze completion patterns
    const completionByDay = {};
    const completionByCategory = {};
    const averageCompletionTimes = {};
    
    completedTodos.forEach(todo => {
      if (todo.completedAt && todo.createdAt) {
        // Analyze by day of week
        const day = new Date(todo.completedAt).getDay();
        completionByDay[day] = (completionByDay[day] || 0) + 1;
        
        // Analyze by category
        const category = todo.category || 'general';
        if (!completionByCategory[category]) {
          completionByCategory[category] = { count: 0, totalTime: 0 };
        }
        
        // Calculate completion time
        const completionTime = todo.completedAt - todo.createdAt;
        completionByCategory[category].count++;
        completionByCategory[category].totalTime += completionTime;
      }
    });
    
    // Calculate average completion time by category
    Object.keys(completionByCategory).forEach(category => {
      const { count, totalTime } = completionByCategory[category];
      averageCompletionTimes[category] = count > 0 ? totalTime / count : 0;
    });
    
    // Find the day with highest completion rate
    let mostProductiveDay = 0;
    let highestCompletions = 0;
    
    Object.keys(completionByDay).forEach(day => {
      if (completionByDay[day] > highestCompletions) {
        mostProductiveDay = parseInt(day);
        highestCompletions = completionByDay[day];
      }
    });
    
    // Get tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    // Check if we already have planned tasks for tomorrow for this user
    const existingPlannedTasks = await Todo.find({
      dueDate: {
        $gte: tomorrow,
        $lt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
      },
      user: req.user.id
    });
    
    if (existingPlannedTasks.length > 0) {
      return res.json({
        planned: false,
        message: 'Tasks for tomorrow already exist',
        tasksExisting: existingPlannedTasks.length
      });
    }
    
    // Find uncompleted high priority tasks and set them for tomorrow
    const highPriorityTasks = pendingTodos.filter(todo => todo.priority === 'high');
    
    // Update high priority tasks to be due tomorrow
    for (const task of highPriorityTasks) {
      task.dueDate = tomorrow;
      await task.save();
    }
    
    // Determine optimal number of tasks based on completion history
    // Simple logic: Use the average of completed tasks per day + 1
    const avgCompletedPerDay = completedTodos.length / 7; // rough estimate
    const optimalTaskCount = Math.ceil(Math.max(3, avgCompletedPerDay + 1)); // at least 3 tasks
    
    // If we need more tasks beyond high priority ones
    const additionalTasksNeeded = Math.max(0, optimalTaskCount - highPriorityTasks.length);
    
    if (additionalTasksNeeded > 0) {
      // Get medium priority tasks that aren't scheduled yet
      const mediumPriorityTasks = pendingTodos.filter(
        todo => todo.priority === 'medium' && !todo.dueDate
      );
      
      // Take as many as needed or available
      const tasksToAdd = mediumPriorityTasks.slice(0, additionalTasksNeeded);
      
      // Update them for tomorrow
      for (const task of tasksToAdd) {
        task.dueDate = tomorrow;
        await task.save();
      }
    }
    
    // Get the final list of tomorrow's tasks
    const tomorrowTasks = await Todo.find({
      dueDate: {
        $gte: tomorrow,
        $lt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
      },
      user: req.user.id
    });
    
    res.json({
      planned: true,
      taskCount: tomorrowTasks.length,
      analysis: {
        mostProductiveDay,
        completionByCategory,
        averageCompletionTimes
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;