const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const nodemailer = require("nodemailer");

// @route   POST api/auth/send-verification-code
// @desc    Send email verification code
// @access  Public
router.post("/send-verification-code", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  try {
    // Check if user already exists and is verified
    const existingUser = await User.findOne({ email, isVerified: true });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: "An account with this email already exists and is verified" 
      });
    }

    // Generate 6-digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpires = Date.now() + 10 * 60 * 1000; // expires in 10 minutes

    // Update user or create temp user record if not exists
    await User.findOneAndUpdate(
      { email },
      {
        email,
        verificationCode: code,
        codeExpires,
        isVerified: false,
      },
      { upsert: true, new: true }
    );

    // Setup email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Send verification email
    await transporter.sendMail({
      from: `"Your App Name" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Email Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4f46e5;">Verify Your Email</h2>
          <p>Thank you for signing up! Please use the following verification code to complete your registration:</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <h1 style="font-size: 32px; letter-spacing: 5px; margin: 0; color: #4b5563;">${code}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    });

    return res.json({ 
      success: true, 
      message: "Verification code sent to your email" 
    });
  } catch (error) {
    console.error("Error sending verification code:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to send verification code. Please try again." 
    });
  }
});

// @route   POST api/auth/verify-code
// @desc    Verify email code
// @access  Public
router.post("/verify-code", async (req, res) => {
  const { email, code } = req.body;
  
  if (!email || !code) {
    return res.status(400).json({ 
      success: false, 
      message: "Email and verification code are required" 
    });
  }

  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: "No verification was requested for this email" 
      });
    }
    
    if (user.verificationCode !== code) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid verification code" 
      });
    }
    
    if (Date.now() > user.codeExpires) {
      return res.status(400).json({ 
        success: false, 
        message: "Verification code has expired. Please request a new one." 
      });
    }

    // Mark as verified but don't clear the code yet (will be cleared after registration)
    user.isVerified = true;
    await user.save();

    res.json({ 
      success: true, 
      message: "Email verified successfully" 
    });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Verification failed. Please try again." 
    });
  }
});

// @route   POST api/auth/register
// @desc    Register a user
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if required fields are provided
    if (!name || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user && user.password) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already exists' 
      });
    }

    // Verify that the email has been verified
    if (!user || !user.isVerified) {
      return res.status(400).json({ 
        success: false,
        message: 'Email verification required. Please verify your email first.' 
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update existing user record or create new one
    if (user) {
      // Update existing user record (from verification)
      user.name = name;
      user.password = hashedPassword;
      user.verificationCode = null;  // Clear verification code
      user.codeExpires = null;       // Clear code expiry
      await user.save();
    } else {
      // Create new user
      user = new User({
        name,
        email,
        password: hashedPassword,
        isVerified: true
      });
      await user.save();
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check if email is verified
    if (!user.isVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email not verified. Please verify your email before logging in.' 
      });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET api/auth/user
// @desc    Get user data
// @access  Private
router.get('/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password -verificationCode -codeExpires -resetCode -resetCodeExpires');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('User fetch error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   POST api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email is required' 
    });
  }

  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Generate reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
    
    // Save reset code to user
    user.resetCode = resetCode;
    user.resetCodeExpires = resetCodeExpires;
    await user.save();
    
    // Setup email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Send password reset email
    await transporter.sendMail({
      from: `"Your App Name" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4f46e5;">Reset Your Password</h2>
          <p>You requested a password reset. Please use the following code to reset your password:</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <h1 style="font-size: 32px; letter-spacing: 5px; margin: 0; color: #4b5563;">${resetCode}</h1>
          </div>
          <p>This code will expire in 30 minutes.</p>
          <p>If you didn't request this change, you can safely ignore this email.</p>
        </div>
      `,
    });

    res.json({ 
      success: true, 
      message: "Password reset code sent to your email" 
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   POST api/auth/reset-password
// @desc    Reset password with code
// @access  Public
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  
  if (!email || !code || !newPassword) {
    return res.status(400).json({ 
      success: false,
      message: 'Email, reset code, and new password are required' 
    });
  }

  try {
    const user = await User.findOne({ 
      email, 
      resetCode: code,
      resetCodeExpires: { $gt: Date.now() } 
    });
    
    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or expired reset code' 
      });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    
    // Clear reset code fields
    user.resetCode = null;
    user.resetCodeExpires = null;
    
    await user.save();

    res.json({ 
      success: true, 
      message: 'Password has been reset successfully' 
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});

module.exports = router;