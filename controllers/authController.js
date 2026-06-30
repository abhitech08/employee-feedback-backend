const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { validateLogin, validateChangePassword } = require('../validators/auth');
const { validateForgotPassword, validateResetPassword } = require('../validators/passwordReset');

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
  }
  return process.env.JWT_SECRET;
};

// Login
const login = async (req, res) => {
  let connection;
  try {
    const { email, password } = req.body;

    // Validate input
    const { error, value } = validateLogin({ email, password });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    connection = await pool.getConnection();

    // Find user
    const [users] = await connection.execute(
      'SELECT id, name, email, password, role, company_id, department_id FROM users WHERE email = ? AND status = "active"',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await connection.execute(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Log login
    const ipAddress = req.ip || req.connection.remoteAddress;
    const browser = req.get('user-agent');
    await connection.execute(
      'INSERT INTO login_logs (user_id, ip_address, browser) VALUES (?, ?, ?)',
      [user.id, ipAddress, browser]
    );

    // Generate tokens
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, company_id: user.company_id },
      getJwtSecret(),
      { expiresIn: Number(process.env.JWT_EXPIRY || 900) }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      getJwtSecret(),
      { expiresIn: Number(process.env.JWT_REFRESH_EXPIRY || 604800) }
    );

    res.status(200).json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
        department_id: user.department_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Change Password
const changePassword = async (req, res) => {
  let connection;
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Validate input
    const { error } = validateChangePassword({ oldPassword, newPassword });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    connection = await pool.getConnection();

    // Get user
    const [users] = await connection.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify old password
    const isPasswordValid = await bcrypt.compare(oldPassword, users[0].password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Old password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await connection.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Logout
const logout = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    await connection.execute(
      `UPDATE login_logs
       SET logout_time = NOW()
       WHERE id = (
         SELECT id FROM login_logs
         WHERE user_id = ?
         ORDER BY login_time DESC
         LIMIT 1
       )`,
      [req.user.id]
    );

    res.status(200).json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const forgotPassword = async (req, res) => {
  let connection;
  try {
    const { email } = req.body;
    const { error } = validateForgotPassword({ email });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    connection = await pool.getConnection();
    const [users] = await connection.execute('SELECT id, name, email FROM users WHERE email = ? AND status = "active"', [email]);

    if (!users.length) {
      return res.status(200).json({ message: 'If the account exists, a reset link has been generated' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await connection.execute(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [users[0].id, token, expiresAt]
    );

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    console.log(`Password reset link for ${email}: ${resetLink}`);

    res.status(200).json({
      message: 'Password reset link generated',
      resetLink
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const resetPassword = async (req, res) => {
  let connection;
  try {
    const { token, newPassword } = req.body;
    const { error } = validateResetPassword({ token, newPassword });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    connection = await pool.getConnection();
    const [tokens] = await connection.execute(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = FALSE AND expires_at > NOW()',
      [token]
    );

    if (!tokens.length) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await connection.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, tokens[0].user_id]);
    await connection.execute('UPDATE password_reset_tokens SET used = TRUE WHERE id = ?', [tokens[0].id]);

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const refreshToken = async (req, res) => {
  let connection;
  try {
    const token = req.body.refreshToken || req.body.refresh_token;
    if (!token) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const decoded = jwt.verify(token, getJwtSecret());
    connection = await pool.getConnection();
    const [users] = await connection.execute(
      'SELECT id, email, role, company_id, department_id FROM users WHERE id = ? AND status = "active"',
      [decoded.id]
    );

    if (!users.length) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = users[0];
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, company_id: user.company_id },
      getJwtSecret(),
      { expiresIn: Number(process.env.JWT_EXPIRY || 900) }
    );

    res.status(200).json({
      message: 'Token refreshed successfully',
      accessToken,
      user
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Refresh token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  login,
  changePassword,
  logout,
  forgotPassword,
  resetPassword,
  refreshToken
};
